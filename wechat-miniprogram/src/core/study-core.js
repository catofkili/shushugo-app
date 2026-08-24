/*
 * 小程序与未来共享 packages/study-core 的第一块可运行切片。
 *
 * 这里故意不依赖 wx.*：计划、答题、FSRS 状态和撤销都可以在 Node 里对真实
 * nihongo.db 做回归测试，页面/持久化只是很薄的一层适配器。
 */
const fsrsLib = require('../vendor/ts-fsrs.umd.js');

const {
  fsrs,
  createEmptyCard,
  Rating
} = fsrsLib;

const CORE_VERSION = '2026-08-22-study-core-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INTERVAL_DAYS = 365;
const MASTERED_INTERVAL_DAYS = 180;
const DEFAULT_REVIEW_LIMIT = 30;
const DEFAULT_NEW_LIMIT = 12;
const PLAN_VERSION = 'review-first-v1';
const STUDY_MODES = Object.freeze({
  quick: { label: '快速学习', limit: 12 },
  mistakes: { label: '错题本', limit: 30 }
});
/*
 * 三个方向。`review` 是写进 reviews.direction 的那个字符串 —— 它必须和 iOS 端
 * `word-api/directions.ts` 完全一致，否则同一个账号两端同步之后，
 * 小程序答过的汉字卡在 iOS 那边不算「今天答过」，会被再问一遍。
 *
 * 汉字方向的路由键仍叫 kanji（页面和 direction_tasks 都用它，那是本地表），
 * 但流水写 kanji_reading：iOS 把旧的「释义 → 汉字」流水留在 direction='kanji' 当历史归档，
 * 新的读音题是另一个题型，两者不能混进同一份记忆。
 */
const {
  concealedReadingParts,
  kanjiReadingSurface,
  preferredWordSurface,
  shouldStudyKanjiReading
} = require('./orthography');
const { pitchPattern } = require('../runtime/pitch');
const { exampleSegments } = require('../runtime/furigana');
const { lookupDictionary } = require('../runtime/dictionary');

const DIRECTIONS = Object.freeze({
  forward: { table: 'progress', review: 'forward', label: '日语 → 中文' },
  reverse: { table: 'reverse_memory', review: 'reverse', label: '中文 → 日语' },
  kanji: { table: 'kanji_reading_memory', review: 'kanji_reading', label: '表记 → 读音' }
});
const FSRS_COLUMNS = [
  ['fsrs_stability', 'REAL'],
  ['fsrs_difficulty', 'REAL'],
  ['fsrs_due', 'TEXT'],
  ['fsrs_last_review', 'TEXT'],
  ['fsrs_state', 'INTEGER'],
  ['fsrs_steps', 'INTEGER'],
  ['fsrs_reps', 'INTEGER'],
  ['fsrs_lapses', 'INTEGER']
];

const schedulerCache = new Map();

function rowsFor(db, sql, params = []) {
  const result = db.exec(sql, params);
  const first = result[0];
  if (!first) return [];
  return first.values.map((values) => Object.fromEntries(first.columns.map((column, index) => [column, values[index]])));
}

function firstValue(db, sql, params = [], fallback = null) {
  const rows = db.exec(sql, params);
  return rows[0]?.values?.[0]?.[0] ?? fallback;
}

function localStudyDay(date = new Date()) {
  const value = new Date(date);
  if (value.getHours() < 4) value.setDate(value.getDate() - 1);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function studyDayEnd(date = new Date()) {
  const day = localStudyDay(date);
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return new Date(year, month - 1, dayOfMonth + 1, 4, 0, 0, 0);
}

function isoNow(date = new Date()) {
  return new Date(date).toISOString();
}

function getState(db, key, fallback = '') {
  return String(firstValue(db, 'SELECT value FROM app_state WHERE key = ?', [key], fallback) ?? fallback);
}

function setState(db, key, value) {
  db.run('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', [key, String(value)]);
}

function tableColumns(db, table) {
  return new Set(rowsFor(db, `PRAGMA table_info(${table})`).map((row) => String(row.name)));
}

function normalizeDirection(direction) {
  return direction && DIRECTIONS[direction] ? direction : 'forward';
}

function directionStateKey(direction) {
  return normalizeDirection(direction) === 'forward' ? 'current_card' : `current_card_${normalizeDirection(direction)}`;
}

function directionTable(direction) {
  return DIRECTIONS[normalizeDirection(direction)].table;
}

/** 写进 reviews.direction 的字符串。和 iOS 对齐，别拿路由键顶替。 */
function reviewDirection(direction) {
  return DIRECTIONS[normalizeDirection(direction)].review;
}

function ensureDirectionTable(db, table) {
  db.run(`
    CREATE TABLE IF NOT EXISTS ${table} (
      word_id INTEGER PRIMARY KEY,
      score INTEGER NOT NULL DEFAULT 0,
      seen_count INTEGER NOT NULL DEFAULT 0,
      low_history INTEGER NOT NULL DEFAULT 0,
      known_forever INTEGER NOT NULL DEFAULT 0,
      mastered_on TEXT,
      last_seen_on TEXT,
      right_count INTEGER NOT NULL DEFAULT 0,
      fuzzy_count INTEGER NOT NULL DEFAULT 0,
      forgot_count INTEGER NOT NULL DEFAULT 0,
      mistake_streak INTEGER NOT NULL DEFAULT 0,
      last_decay_amount INTEGER NOT NULL DEFAULT 10,
      right_streak INTEGER NOT NULL DEFAULT 0,
      auto_retired_on TEXT,
      fsrs_stability REAL,
      fsrs_difficulty REAL,
      fsrs_due TEXT,
      fsrs_last_review TEXT,
      fsrs_state INTEGER,
      fsrs_steps INTEGER,
      fsrs_reps INTEGER,
      fsrs_lapses INTEGER
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_${table}_fsrs_due ON ${table}(fsrs_due)`);
}

function ensureStudySchema(db) {
  const progressColumns = tableColumns(db, 'progress');
  for (const [name, type] of FSRS_COLUMNS) {
    if (!progressColumns.has(name)) db.run(`ALTER TABLE progress ADD COLUMN ${name} ${type}`);
  }

  const reviewColumns = tableColumns(db, 'reviews');
  if (!reviewColumns.has('direction')) {
    db.run("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS stage1_tasks (
      reviewed_on TEXT NOT NULL,
      word_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (reviewed_on, word_id)
    )
  `);
  ensureDirectionTable(db, 'reverse_memory');
  ensureDirectionTable(db, 'kanji_reading_memory');
  db.run(`
    CREATE TABLE IF NOT EXISTS direction_tasks (
      study_day TEXT NOT NULL,
      direction TEXT NOT NULL,
      word_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (study_day, direction, word_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS mode_tasks (
      study_day TEXT NOT NULL,
      mode TEXT NOT NULL,
      word_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (study_day, mode, word_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS word_notes (
      word_id INTEGER PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS checkins (
      checked_on TEXT PRIMARY KEY
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      entity TEXT NOT NULL,
      natural_key TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (entity, natural_key)
    )
  `);
  db.run('CREATE TABLE IF NOT EXISTS confusion_mastered (group_key TEXT PRIMARY KEY, mastered_on TEXT NOT NULL)');
  db.run('CREATE TABLE IF NOT EXISTS achievement_unlocked (id TEXT PRIMARY KEY, unlocked_on TEXT NOT NULL)');
  db.run('CREATE INDEX IF NOT EXISTS idx_progress_fsrs_due ON progress(fsrs_due)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reviews_day_direction ON reviews(reviewed_on, direction)');
  db.run('CREATE INDEX IF NOT EXISTS idx_stage1_day_order ON stage1_tasks(reviewed_on, order_index)');
  db.run('CREATE INDEX IF NOT EXISTS idx_direction_tasks_day_order ON direction_tasks(study_day, direction, order_index)');
  db.run('CREATE INDEX IF NOT EXISTS idx_mode_tasks_day_order ON mode_tasks(study_day, mode, order_index)');
  // 出厂库不带个人进度行；首次打开时把每个内容词变成一张可调度的新卡。
  db.run('INSERT OR IGNORE INTO progress (word_id) SELECT id FROM words');
  setState(db, 'study_core_version', CORE_VERSION);
}

function scheduler(mode = 'normal') {
  const key = mode;
  if (!schedulerCache.has(key)) {
    schedulerCache.set(key, fsrs({
      request_retention: 0.9,
      maximum_interval: MAX_INTERVAL_DAYS,
      enable_fuzz: false,
      enable_short_term: true,
      learning_steps: mode === 'known' ? [] : ['1m', '10m'],
      relearning_steps: mode === 'known' ? [] : ['10m', '10m']
    }));
  }
  return schedulerCache.get(key);
}

function readFsrsState(row) {
  if (!row || row.fsrs_stability == null || !row.fsrs_due) return null;
  return {
    stability: Number(row.fsrs_stability),
    difficulty: Number(row.fsrs_difficulty),
    due: String(row.fsrs_due),
    lastReview: String(row.fsrs_last_review || row.fsrs_due),
    state: Number(row.fsrs_state ?? 2),
    steps: Number(row.fsrs_steps ?? 0),
    reps: Number(row.fsrs_reps ?? 1),
    lapses: Number(row.fsrs_lapses ?? 0)
  };
}

function toCard(state, now) {
  if (!state) return createEmptyCard(now);
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: state.steps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: new Date(state.lastReview)
  };
}

function clampDue(due, lastReview) {
  const cap = lastReview.getTime() + MAX_INTERVAL_DAYS * DAY_MS;
  return new Date(Math.min(new Date(due).getTime(), cap)).toISOString();
}

function recordFsrsReview(previous, answer, now) {
  const mode = !previous && answer === 'know' ? 'known' : 'normal';
  const rating = answer === 'forgot'
    ? Rating.Again
    : answer === 'fuzzy'
      ? Rating.Hard
      : answer === 'known_forever' || mode === 'known'
        ? Rating.Easy
        : Rating.Good;
  const card = toCard(previous, now);
  const scheduled = scheduler(mode).repeat(card, now)[rating].card;
  const lastReview = scheduled.last_review || now;
  return {
    stability: scheduled.stability,
    difficulty: scheduled.difficulty,
    due: clampDue(scheduled.due, lastReview),
    lastReview: lastReview.toISOString(),
    state: scheduled.state,
    steps: scheduled.learning_steps,
    reps: scheduled.reps,
    lapses: scheduled.lapses
  };
}

function intervalDays(state) {
  return (new Date(state.due).getTime() - new Date(state.lastReview).getTime()) / DAY_MS;
}

function isTaskComplete(progress, end) {
  return Number(progress.known_forever) === 1
    || (progress.fsrs_due && new Date(progress.fsrs_due).getTime() > end.getTime());
}

function createTodayPlan(db, options = {}) {
  ensureStudySchema(db);
  const day = localStudyDay(options.now);
  const existing = Number(firstValue(db, 'SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?', [day], 0));
  if (existing > 0) return { day, created: false, count: existing };

  const reviewLimit = Math.max(0, Number(options.reviewLimit ?? DEFAULT_REVIEW_LIMIT));
  const newLimit = Math.max(0, Number(options.newLimit ?? DEFAULT_NEW_LIMIT));
  const end = studyDayEnd(options.now);
  const endISO = end.toISOString();
  const reviewRows = rowsFor(db, `
    SELECT p.word_id
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
    ORDER BY CASE WHEN p.fsrs_due IS NULL THEN 0 ELSE 1 END,
             p.fsrs_due ASC, COALESCE(p.fsrs_lapses, 0) DESC,
             w.importance DESC, w.id ASC
    LIMIT ?
  `, [endISO, reviewLimit]);
  let order = 1;
  db.run('BEGIN TRANSACTION');
  try {
    for (const row of reviewRows) {
      db.run(
        'INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, \'review\', ?)',
        [day, Number(row.word_id), order++]
      );
    }
    const newRows = rowsFor(db, `
      SELECT p.word_id
      FROM progress p
      JOIN words w ON w.id = p.word_id
      WHERE p.known_forever = 0 AND p.seen_count = 0
      ORDER BY w.importance DESC, COALESCE(w.shuffle_rank, 0) DESC, w.id ASC
      LIMIT ?
    `, [newLimit]);
    for (const row of newRows) {
      db.run(
        'INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, \'new\', ?)',
        [day, Number(row.word_id), order++]
      );
    }
    setState(db, 'study_plan_version', PLAN_VERSION);
    setState(db, 'study_plan_day', day);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return { day, created: true, count: order - 1 };
}

function createDirectionPlan(db, direction, options = {}) {
  const normalized = normalizeDirection(direction);
  if (normalized === 'forward') return createTodayPlan(db, options);
  ensureStudySchema(db);
  const day = localStudyDay(options.now);
  const existing = Number(firstValue(db, `SELECT COUNT(*) FROM direction_tasks WHERE study_day = ? AND direction = ?`, [day, normalized], 0));
  if (existing > 0) return { day, direction: normalized, created: false, count: existing };
  const table = directionTable(normalized);
  const limit = Math.max(1, Number(options.directionLimit ?? DEFAULT_NEW_LIMIT));
  const endISO = studyDayEnd(options.now).toISOString();
  // 汉字读音卡只对「现代日语里确实写汉字、而且写法和读音不同」的词成立。
  // 不筛的话 コーヒー、ちょうど 这种也会被当成汉字卡问一遍读音 —— 那是白考。
  // SQL 只能粗筛 kanji <> kana，细判交给 orthography（和 iOS 同一份数据）。
  const needsSurfaceFilter = normalized === 'kanji';
  const rows = rowsFor(db, `
    SELECT p.word_id, w.kanji, w.kana
    FROM progress p
    JOIN words w ON w.id = p.word_id
    LEFT JOIN ${table} d ON d.word_id = p.word_id
    WHERE p.seen_count > 0
      AND COALESCE(d.known_forever, 0) = 0
      AND (d.fsrs_due IS NULL OR d.fsrs_due <= ?)
      ${needsSurfaceFilter ? 'AND w.kanji <> w.kana' : ''}
    ORDER BY CASE WHEN d.fsrs_due IS NULL THEN 0 ELSE 1 END,
             d.fsrs_due ASC, w.importance DESC, w.id ASC
    LIMIT ?
  `, [endISO, needsSurfaceFilter ? limit * 4 : limit])
    .filter((row) => !needsSurfaceFilter || shouldStudyKanjiReading(row))
    .slice(0, limit);
  db.run('BEGIN TRANSACTION');
  try {
    rows.forEach((row, index) => {
      const wordId = Number(row.word_id);
      db.run(`INSERT OR IGNORE INTO ${table} (word_id) VALUES (?)`, [wordId]);
      db.run(`
        INSERT OR IGNORE INTO direction_tasks (study_day, direction, word_id, order_index)
        VALUES (?, ?, ?, ?)
      `, [day, normalized, wordId, index + 1]);
    });
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return { day, direction: normalized, created: true, count: rows.length };
}

/**
 * 快速学习和错题本各自有一份当天队列，不写进经典模式的 stage1_tasks。
 * 这样用户在快速模式里清掉的卡不会把经典模式的计划顺序悄悄改掉，
 * 但作答本身仍然写同一套 progress / reviews / FSRS。
 */
function createModePlan(db, mode, options = {}) {
  if (!STUDY_MODES[mode]) throw new Error(`不支持的学习模式：${mode}`);
  ensureStudySchema(db);
  const day = localStudyDay(options.now);
  const existing = Number(firstValue(db, 'SELECT COUNT(*) FROM mode_tasks WHERE study_day = ? AND mode = ?', [day, mode], 0));
  if (existing > 0) return { day, mode, created: false, count: existing };
  const limit = Math.max(1, Number(options.modeLimit ?? STUDY_MODES[mode].limit));
  const endISO = studyDayEnd(options.now).toISOString();
  const rows = mode === 'quick'
    ? rowsFor(db, `
        SELECT p.word_id
        FROM progress p JOIN words w ON w.id = p.word_id
        WHERE p.known_forever = 0
          AND (p.seen_count = 0 OR (p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)))
        ORDER BY CASE WHEN p.seen_count > 0 THEN 0 ELSE 1 END,
                 CASE WHEN p.fsrs_due IS NULL THEN 0 ELSE 1 END,
                 p.fsrs_due ASC, COALESCE(p.fsrs_lapses, 0) DESC,
                 w.importance DESC, w.id ASC
        LIMIT ?
      `, [endISO, limit])
    : rowsFor(db, `
        SELECT p.word_id
        FROM progress p JOIN words w ON w.id = p.word_id
        WHERE p.known_forever = 0 AND EXISTS (
          SELECT 1 FROM reviews r
          WHERE r.word_id = p.word_id AND r.direction = 'forward'
            AND r.answer IN ('forgot', 'fuzzy')
        )
        ORDER BY COALESCE(p.mistake_streak, 0) DESC,
                 COALESCE(p.fsrs_lapses, 0) DESC,
                 COALESCE(p.last_seen_on, '') DESC, w.importance DESC, w.id ASC
        LIMIT ?
      `, [limit]);
  db.run('BEGIN TRANSACTION');
  try {
    rows.forEach((row, index) => db.run(`
      INSERT OR IGNORE INTO mode_tasks (study_day, mode, word_id, order_index)
      VALUES (?, ?, ?, ?)
    `, [day, mode, Number(row.word_id), index + 1]));
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return { day, mode, created: true, count: rows.length };
}

function getTodayStats(db, now = new Date(), direction = 'forward') {
  ensureStudySchema(db);
  const normalized = normalizeDirection(direction);
  const day = localStudyDay(now);
  const end = studyDayEnd(now);
  if (normalized !== 'forward') {
    const table = directionTable(normalized);
    const planned = Number(firstValue(db, 'SELECT COUNT(*) FROM direction_tasks WHERE study_day = ? AND direction = ?', [day, normalized], 0));
    const answered = Number(firstValue(db, 'SELECT COUNT(*) FROM reviews WHERE reviewed_on = ? AND direction = ?', [day, reviewDirection(normalized)], 0));
    const completed = Number(firstValue(db, `
      SELECT COUNT(*) FROM direction_tasks t JOIN ${table} d ON d.word_id = t.word_id
      WHERE t.study_day = ? AND t.direction = ?
        AND (d.known_forever = 1 OR (d.fsrs_due IS NOT NULL AND d.fsrs_due > ?))
    `, [day, normalized, end.toISOString()], 0));
    const dueTotal = Number(firstValue(db, `SELECT COUNT(*) FROM ${table} WHERE known_forever = 0 AND seen_count > 0 AND (fsrs_due IS NULL OR fsrs_due <= ?)`, [end.toISOString()], 0));
    return { day, direction: normalized, planned, answered, newAnswered: 0, completed: Math.min(completed, planned), remaining: Math.max(planned - completed, 0), dueTotal };
  }
  const planned = Number(firstValue(db, 'SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?', [day], 0));
  const answered = Number(firstValue(db, "SELECT COUNT(*) FROM reviews WHERE reviewed_on = ? AND direction = 'forward'", [day], 0));
  const newAnswered = Number(firstValue(db, `
    SELECT COUNT(*) FROM stage1_tasks t
    JOIN reviews r ON r.word_id = t.word_id AND r.reviewed_on = t.reviewed_on AND r.direction = 'forward'
    WHERE t.reviewed_on = ? AND t.task_type = 'new'
  `, [day], 0));
  const completed = Number(firstValue(db, `
    SELECT COUNT(*)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
  `, [day, end.toISOString()], 0));
  return {
    day,
    planned,
    answered,
    newAnswered,
    completed: Math.min(completed, planned),
    remaining: Math.max(planned - completed, 0),
    dueTotal: Number(firstValue(db, 'SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count > 0 AND (fsrs_due IS NULL OR fsrs_due <= ?)', [end.toISOString()], 0))
  };
}

function getModeStats(db, mode, now = new Date()) {
  ensureStudySchema(db);
  if (!STUDY_MODES[mode]) throw new Error(`不支持的学习模式：${mode}`);
  const day = localStudyDay(now);
  const end = studyDayEnd(now);
  const planned = Number(firstValue(db, 'SELECT COUNT(*) FROM mode_tasks WHERE study_day = ? AND mode = ?', [day, mode], 0));
  const answered = Number(firstValue(db, `
    SELECT COUNT(*) FROM reviews r JOIN mode_tasks t ON t.word_id = r.word_id
    WHERE t.study_day = ? AND t.mode = ? AND r.reviewed_on = ? AND r.direction = 'forward'
  `, [day, mode, day], 0));
  const completed = Number(firstValue(db, `
    SELECT COUNT(*) FROM mode_tasks t JOIN progress p ON p.word_id = t.word_id
    WHERE t.study_day = ? AND t.mode = ?
      AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
  `, [day, mode, end.toISOString()], 0));
  return {
    day, mode, planned, answered,
    newAnswered: 0,
    completed: Math.min(completed, planned),
    remaining: Math.max(planned - completed, 0),
    dueTotal: Number(firstValue(db, 'SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count > 0 AND (fsrs_due IS NULL OR fsrs_due <= ?)', [end.toISOString()], 0))
  };
}

function cardById(db, wordId, direction = 'forward') {
  const normalized = normalizeDirection(direction);
  const stateTable = directionTable(normalized);
  const stateJoin = normalized === 'forward'
    ? 'JOIN progress p ON p.word_id = w.id'
    : `LEFT JOIN ${stateTable} p ON p.word_id = w.id`;
  const row = rowsFor(db, `
    SELECT w.id, w.kanji, w.kana, w.meaning, w.pos, w.verb_type,
           w.example_jp, w.example_meaning, w.example_furigana, w.jlpt_level,
           COALESCE(p.seen_count, 0) AS seen_count, COALESCE(p.known_forever, 0) AS known_forever,
           p.last_seen_on, p.fsrs_due, p.fsrs_state, p.fsrs_steps, p.fsrs_reps, p.fsrs_lapses,
           COALESCE(n.note, '') AS note
    FROM words w ${stateJoin}
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `, [wordId])[0];
  return row ? { ...row, direction: normalized, pitch: pitchPattern(row.kanji, row.kana), exampleSegments: exampleSegments(row.example_jp, row.example_furigana), dictionaryEntries: lookupDictionary(db, row.kanji, row.kana), wordOrigin: /^[A-Za-z]/.test(String(row.kanji || '')) ? String(row.kanji) : '' } : null;
}

function nextModeCard(db, mode, options = {}) {
  createModePlan(db, mode, options);
  const day = localStudyDay(options.now);
  const end = studyDayEnd(options.now);
  const currentKey = `current_card_${mode}`;
  const current = getState(db, currentKey, '');
  const params = [day, mode, end.toISOString()];
  const level = options.level && /^N[1-5]$/.test(options.level) ? options.level : null;
  const levelClause = level ? ' AND w.jlpt_level = ?' : '';
  if (level) params.push(level);
  if (current) params.push(Number(current));
  const row = rowsFor(db, `
    SELECT w.id, w.kanji, w.kana, w.meaning, w.pos, w.verb_type,
           w.example_jp, w.example_meaning, w.example_furigana, w.jlpt_level,
           p.seen_count, p.known_forever, p.last_seen_on,
           p.fsrs_due, p.fsrs_state, p.fsrs_steps, p.fsrs_reps, p.fsrs_lapses,
           t.order_index, t.mode, COALESCE(n.note, '') AS note
    FROM mode_tasks t JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.study_day = ? AND t.mode = ?
      AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
      ${levelClause}
      ${current ? 'AND w.id != ?' : ''}
    ORDER BY t.order_index ASC LIMIT 1
  `, params)[0] ?? null;
  if (!row) {
    setState(db, currentKey, '0');
    return null;
  }
  setState(db, currentKey, String(row.id));
  return { ...row, direction: 'forward', mode, prompt: row.meaning, answerText: preferredWordSurface(row), surface: preferredWordSurface(row), pitch: pitchPattern(row.kanji, row.kana), exampleSegments: exampleSegments(row.example_jp, row.example_furigana), dictionaryEntries: lookupDictionary(db, row.kanji, row.kana), wordOrigin: /^[A-Za-z]/.test(String(row.kanji || '')) ? String(row.kanji) : '' };
}

function nextCard(db, options = {}) {
  ensureStudySchema(db);
  if (options.mode && STUDY_MODES[options.mode]) return nextModeCard(db, options.mode, options);
  const direction = normalizeDirection(options.direction);
  if (direction !== 'forward') return nextDirectionCard(db, direction, options);
  createTodayPlan(db, options);
  const day = localStudyDay(options.now);
  const end = studyDayEnd(options.now);
  const current = getState(db, directionStateKey(direction), '');
  const level = options.level && /^N[1-5]$/.test(options.level) ? options.level : null;
  const params = [day, end.toISOString()];
  let levelClause = '';
  if (level) {
    levelClause = ' AND w.jlpt_level = ?';
    params.push(level);
  }
  if (current) params.push(Number(current));
  const row = rowsFor(db, `
    SELECT w.id, w.kanji, w.kana, w.meaning, w.pos, w.verb_type,
           w.example_jp, w.example_meaning, w.example_furigana, w.jlpt_level,
           p.seen_count, p.known_forever, p.last_seen_on,
           p.fsrs_due, p.fsrs_state, p.fsrs_steps, p.fsrs_reps, p.fsrs_lapses,
           t.task_type, t.order_index, COALESCE(n.note, '') AS note
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
      ${levelClause}
      ${current ? 'AND w.id != ?' : ''}
    ORDER BY t.order_index ASC
    LIMIT 1
  `, params)[0] ?? null;
  if (!row) {
  setState(db, directionStateKey(direction), '0');
    return null;
  }
  setState(db, directionStateKey(direction), String(row.id));
  return { ...row, direction, prompt: row.meaning, answerText: preferredWordSurface(row), surface: preferredWordSurface(row), pitch: pitchPattern(row.kanji, row.kana), dictionaryEntries: lookupDictionary(db, row.kanji, row.kana), exampleSegments: exampleSegments(row.example_jp, row.example_furigana), wordOrigin: /^[A-Za-z]/.test(String(row.kanji || '')) ? String(row.kanji) : '' };
}

function nextDirectionCard(db, direction, options = {}) {
  createDirectionPlan(db, direction, options);
  const day = localStudyDay(options.now);
  const end = studyDayEnd(options.now);
  const table = directionTable(direction);
  const current = getState(db, directionStateKey(direction), '');
  const level = options.level && /^N[1-5]$/.test(options.level) ? options.level : null;
  const params = [day, direction, end.toISOString()];
  let levelClause = '';
  if (level) {
    levelClause = ' AND w.jlpt_level = ?';
    params.push(level);
  }
  if (current) params.push(Number(current));
  const row = rowsFor(db, `
    SELECT w.id, w.kanji, w.kana, w.meaning, w.pos, w.verb_type,
           w.example_jp, w.example_meaning, w.example_furigana, w.jlpt_level,
           COALESCE(d.seen_count, 0) AS seen_count, COALESCE(d.known_forever, 0) AS known_forever,
           d.last_seen_on, d.fsrs_due, d.fsrs_state, d.fsrs_steps, d.fsrs_reps, d.fsrs_lapses,
           t.order_index, COALESCE(n.note, '') AS note
    FROM direction_tasks t
    JOIN words w ON w.id = t.word_id
    LEFT JOIN ${table} d ON d.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.study_day = ? AND t.direction = ?
      AND COALESCE(d.known_forever, 0) = 0
      AND (d.fsrs_due IS NULL OR d.fsrs_due <= ?)
      ${levelClause}
      ${current ? 'AND w.id != ?' : ''}
    ORDER BY t.order_index ASC
    LIMIT 1
  `, params)[0] ?? null;
  if (!row) {
    setState(db, directionStateKey(direction), '0');
    return null;
  }
  setState(db, directionStateKey(direction), String(row.id));
  const normalized = normalizeDirection(direction);
  // 卡面词形只有一份口径：外来語行的 kanji 存的是词源(camera / apartment house)，
  // 照直摆大字等于让人学英文；汉字读音卡还要用标准化后的表记去遮读音。
  const surface = normalized === 'kanji' ? kanjiReadingSurface(row) : preferredWordSurface(row);
  const prompt = normalized === 'reverse'
    ? surface + (row.kana && row.kana !== surface ? `（${row.kana}）` : '')
    : row.meaning;
  const answerText = normalized === 'reverse' ? row.meaning : surface;
  return {
    ...row,
    direction: normalized,
    prompt,
    answerText,
    surface,
    // 汉字读音卡揭晓前只露送り仮名/片假名，汉字对应的那几拍不进页面数据
    concealedReading: normalized === 'kanji' ? concealedReadingParts(row) : null,
    pitch: pitchPattern(row.kanji, row.kana),
    exampleSegments: exampleSegments(row.example_jp, row.example_furigana),
    dictionaryEntries: lookupDictionary(db, row.kanji, row.kana),
    wordOrigin: /^[A-Za-z]/.test(String(row.kanji || '')) ? String(row.kanji) : ''
  };
}

function snapshotProgress(row) {
  const names = [
    'score', 'seen_count', 'low_history', 'known_forever', 'mastered_on',
    'last_seen_on', 'right_count', 'fuzzy_count', 'forgot_count',
    'mistake_streak', 'last_decay_amount', 'right_streak', 'auto_retired_on',
    'fsrs_stability', 'fsrs_difficulty', 'fsrs_due', 'fsrs_last_review',
    'fsrs_state', 'fsrs_steps', 'fsrs_reps', 'fsrs_lapses'
  ];
  return Object.fromEntries(names.map((name) => [name, row[name] ?? null]));
}

function recordDirectionalAnswer(db, wordId, answer, direction, options = {}) {
  const table = directionTable(direction);
  const stateKey = directionStateKey(direction);
  const expected = getState(db, stateKey, '');
  if (expected && expected !== '0' && Number(expected) !== Number(wordId)) {
    throw new Error('这张卡已经过期，请重新取下一张');
  }
  db.run(`INSERT OR IGNORE INTO ${table} (word_id) VALUES (?)`, [wordId]);
  const now = new Date(options.now ?? new Date());
  const day = localStudyDay(now);
  const row = rowsFor(db, `
    SELECT w.id, d.*
    FROM words w JOIN ${table} d ON d.word_id = w.id
    WHERE w.id = ?
  `, [wordId])[0];
  if (!row) throw new Error(`找不到单词 ${wordId}`);
  const previous = snapshotProgress(row);
  const previousCurrentCard = expected || '0';
  const nextFsrs = recordFsrsReview(readFsrsState(row), answer, now);
  const mastered = answer === 'known_forever' || intervalDays(nextFsrs) >= MASTERED_INTERVAL_DAYS;
  const scoreDelta = { forgot: -10, fuzzy: -2, know: 10, known_forever: 10 }[answer];
  const nextScore = Math.max(0, Math.min(100, Number(row.score ?? 0) + scoreDelta));
  const isRight = answer === 'know' || answer === 'known_forever';
  const isWrong = answer === 'forgot' || answer === 'fuzzy';
  const reviewCreatedAt = isoNow(now);

  db.run('BEGIN TRANSACTION');
  try {
    db.run(`
      UPDATE ${table} SET
        score = ?, seen_count = seen_count + 1,
        known_forever = ?, mastered_on = ?, last_seen_on = ?,
        right_count = right_count + ?, fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
        mistake_streak = ?, right_streak = ?,
        fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
        fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ?
      WHERE word_id = ?
    `, [
      nextScore, mastered ? 1 : 0, mastered ? day : row.mastered_on, day,
      isRight ? 1 : 0, answer === 'fuzzy' ? 1 : 0, answer === 'forgot' ? 1 : 0,
      isWrong ? Number(row.mistake_streak ?? 0) + 1 : 0,
      isRight ? Number(row.right_streak ?? 0) + 1 : 0,
      nextFsrs.stability, nextFsrs.difficulty, nextFsrs.due, nextFsrs.lastReview,
      nextFsrs.state, nextFsrs.steps, nextFsrs.reps, nextFsrs.lapses, wordId
    ]);
    db.run(`
      INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [wordId, answer, nextScore, day, reviewCreatedAt, reviewDirection(direction)]);
    db.run('INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)', [day]);
    setState(db, 'undo_snapshot', JSON.stringify({
      wordId: Number(wordId), direction, entityTable: table, previous, previousCurrentCard,
      reviewCreatedAt, day
    }));
    setState(db, stateKey, '0');
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return { card: cardById(db, wordId, direction), fsrs: nextFsrs, mastered, stats: getTodayStats(db, now, direction) };
}

function recordForwardAnswer(db, wordId, answer, options = {}, currentStateKey = directionStateKey('forward'), mode = '') {
  ensureStudySchema(db);
  if (!['forgot', 'fuzzy', 'know', 'known_forever'].includes(answer)) {
    throw new Error(`不支持的答案：${answer}`);
  }
  const direction = normalizeDirection(options.direction);
  if (direction !== 'forward') return recordDirectionalAnswer(db, wordId, answer, direction, options);
  const expected = getState(db, currentStateKey, '');
  if (expected && expected !== '0' && Number(expected) !== Number(wordId)) {
    throw new Error('这张卡已经过期，请重新取下一张');
  }
  const now = new Date(options.now ?? new Date());
  const day = localStudyDay(now);
  const row = rowsFor(db, `
    SELECT w.id, p.*
    FROM words w JOIN progress p ON p.word_id = w.id
    WHERE w.id = ?
  `, [wordId])[0];
  if (!row) throw new Error(`找不到单词 ${wordId}`);
  const previous = snapshotProgress(row);
  const previousCurrentCard = expected || '0';
  const previousFsrs = readFsrsState(row);
  const nextFsrs = recordFsrsReview(previousFsrs, answer, now);
  const mastered = answer === 'known_forever' || intervalDays(nextFsrs) >= MASTERED_INTERVAL_DAYS;
  const scoreDelta = { forgot: -10, fuzzy: -2, know: 10, known_forever: 10 }[answer];
  const nextScore = Math.max(0, Math.min(100, Number(row.score ?? 0) + scoreDelta));
  const isRight = answer === 'know' || answer === 'known_forever';
  const isWrong = answer === 'forgot' || answer === 'fuzzy';
  const reviewCreatedAt = isoNow(now);
  const naturalReviewKey = `${wordId}\u0000${reviewCreatedAt}\u0000forward`;

  db.run('BEGIN TRANSACTION');
  try {
    db.run(`
      UPDATE progress SET
        score = ?, seen_count = seen_count + 1,
        known_forever = ?, mastered_on = ?, last_seen_on = ?,
        right_count = right_count + ?, fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
        mistake_streak = ?, right_streak = ?,
        fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
        fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ?
      WHERE word_id = ?
    `, [
      nextScore,
      mastered ? 1 : 0,
      mastered ? day : row.mastered_on,
      day,
      isRight ? 1 : 0,
      answer === 'fuzzy' ? 1 : 0,
      answer === 'forgot' ? 1 : 0,
      isWrong ? Number(row.mistake_streak ?? 0) + 1 : 0,
      isRight ? Number(row.right_streak ?? 0) + 1 : 0,
      nextFsrs.stability,
      nextFsrs.difficulty,
      nextFsrs.due,
      nextFsrs.lastReview,
      nextFsrs.state,
      nextFsrs.steps,
      nextFsrs.reps,
      nextFsrs.lapses,
      wordId
    ]);
    db.run(`
      INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction)
      VALUES (?, ?, ?, ?, ?, 'forward')
    `, [wordId, answer, nextScore, day, reviewCreatedAt]);
    db.run('INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)', [day]);
    setState(db, 'undo_snapshot', JSON.stringify({
      wordId: Number(wordId), direction: 'forward', entityTable: 'progress',
      previous,
      previousCurrentCard,
      currentStateKey,
      mode,
      reviewKey: naturalReviewKey,
      reviewCreatedAt,
      day
    }));
    setState(db, currentStateKey, '0');
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return {
    card: cardById(db, wordId), fsrs: nextFsrs, mastered,
    stats: mode ? getModeStats(db, mode, now) : getTodayStats(db, now)
  };
}

function recordAnswer(db, wordId, answer, options = {}) {
  ensureStudySchema(db);
  if (!['forgot', 'fuzzy', 'know', 'known_forever'].includes(answer)) {
    throw new Error(`不支持的答案：${answer}`);
  }
  const mode = options.mode && STUDY_MODES[options.mode] ? options.mode : '';
  if (mode) return recordForwardAnswer(db, wordId, answer, options, `current_card_${mode}`, mode);
  const direction = normalizeDirection(options.direction);
  if (direction !== 'forward') return recordDirectionalAnswer(db, wordId, answer, direction, options);
  return recordForwardAnswer(db, wordId, answer, options);
}

function undoLastAnswer(db, options = {}) {
  ensureStudySchema(db);
  const raw = getState(db, 'undo_snapshot', '');
  if (!raw) return { undone: false, reason: '没有可撤销的作答' };
  const snapshot = JSON.parse(raw);
  const direction = normalizeDirection(snapshot.direction);
  const entityTable = snapshot.entityTable || directionTable(direction);
  const review = rowsFor(db, `
    SELECT id FROM reviews
    WHERE word_id = ? AND created_at = ? AND direction = ?
  `, [snapshot.wordId, snapshot.reviewCreatedAt, reviewDirection(direction)])[0];
  if (!review) {
    setState(db, 'undo_snapshot', '');
    return { undone: false, reason: '作答流水已经被合并或删除，不能安全撤销' };
  }
  db.run('BEGIN TRANSACTION');
  try {
    const p = snapshot.previous;
    const columns = Object.keys(p);
    db.run(`UPDATE ${entityTable} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE word_id = ?`, [...columns.map((column) => p[column]), snapshot.wordId]);
    db.run('DELETE FROM reviews WHERE id = ?', [Number(review.id)]);
    setState(db, snapshot.currentStateKey || directionStateKey(direction), snapshot.previousCurrentCard || '0');
    setState(db, 'undo_snapshot', '');
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return {
    undone: true,
    wordId: snapshot.wordId,
    direction,
    stats: snapshot.mode ? getModeStats(db, snapshot.mode, options.now) : getTodayStats(db, options.now, direction)
  };
}

function saveNote(db, wordId, note, now = new Date()) {
  ensureStudySchema(db);
  db.run(`
    INSERT INTO word_notes (word_id, note, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(word_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `, [wordId, String(note ?? ''), isoNow(now)]);
}

module.exports = {
  CORE_VERSION,
  DIRECTIONS,
  DEFAULT_NEW_LIMIT,
  DEFAULT_REVIEW_LIMIT,
  ensureStudySchema,
  localStudyDay,
  studyDayEnd,
  createTodayPlan,
  createDirectionPlan,
  createModePlan,
  getTodayStats,
  getModeStats,
  nextCard,
  cardById,
  recordAnswer,
  undoLastAnswer,
  saveNote,
  getState,
  setState,
  rowsFor,
  firstValue
};
