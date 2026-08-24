/*
 * 词库页的数据层。
 *
 * 这不是一个“搜索框 demo”：筛选、记忆色阶、到期/顽固词统计和排序都在
 * 本地 SQLite 完成，页面只拿当前的一页。这样 10,000+ 条词在微信端不会被
 * 一次性铺进 WXML，也不会因为翻词典而改动 FSRS。
 */
const core = require('../core/study-core');

function databaseStore() {
  return require('./database-store');
}

const MEMORY_BANDS = Object.freeze([
  { id: 'mastered', label: '已掌握', hint: '间隔已到半年以上，或手动标为熟知' },
  { id: 'd5', label: '3 个月+', hint: '记得很牢，长间隔复习中' },
  { id: 'd4', label: '1–3 个月', hint: '正在变稳' },
  { id: 'd3', label: '1–3 周', hint: '正在变熟' },
  { id: 'd2', label: '3–7 天', hint: '还不牢，隔几天就会忘' },
  { id: 'd1', label: '1–3 天', hint: '生疏，撑不过几天' },
  { id: 'd0', label: '不到 1 天', hint: '刚学过或基本没记住' },
  { id: 'unseen', label: '未学', hint: '还没学过这个词' }
]);

const POS_BUCKETS = Object.freeze([
  { id: 'noun', label: '名词' },
  { id: 'suru', label: 'する动词' },
  { id: 'verb', label: '动词' },
  { id: 'adj', label: '形容词' },
  { id: 'adv', label: '副词' },
  { id: 'pron', label: '代词·连体' },
  { id: 'affix', label: '接辞·助词' },
  { id: 'other', label: '其他' }
]);

const DEFAULT_FILTERS = Object.freeze({
  level: 'all',
  band: 'all',
  pos: 'all',
  search: '',
  sort: 'level'
});

const MASTERED_SQL = `(p.fsrs_due IS NOT NULL AND p.fsrs_last_review IS NOT NULL
  AND julianday(p.fsrs_due) - julianday(p.fsrs_last_review) >= 180)`;
const BAND_SQL = `CASE
  WHEN p.known_forever = 1 OR ${MASTERED_SQL} THEN 'mastered'
  WHEN p.seen_count = 0 THEN 'unseen'
  WHEN p.fsrs_stability IS NULL OR p.fsrs_stability < 1 THEN 'd0'
  WHEN p.fsrs_stability < 3 THEN 'd1'
  WHEN p.fsrs_stability < 7 THEN 'd2'
  WHEN p.fsrs_stability < 21 THEN 'd3'
  WHEN p.fsrs_stability < 90 THEN 'd4'
  ELSE 'd5'
END`;
const DUE_SQL = `(p.known_forever = 0 AND p.seen_count > 0
  AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?))`;
const LEECH_SQL = 'COALESCE(p.fsrs_lapses, 0) >= 8';
const LEVEL_ORDER_SQL = `CASE w.jlpt_level
  WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3
  WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END`;
const ORDER_SQL = Object.freeze({
  level: `${LEVEL_ORDER_SQL} ASC, w.importance DESC, w.id ASC`,
  weakest: `CASE WHEN p.seen_count = 0 AND p.known_forever = 0 THEN 1 ELSE 0 END ASC,
    COALESCE(p.fsrs_stability, 999999) ASC, w.importance DESC, w.id ASC`,
  recent: `CASE WHEN p.fsrs_last_review IS NULL THEN 1 ELSE 0 END ASC,
    p.fsrs_last_review DESC, w.id ASC`,
  kana: 'w.kana ASC, w.id ASC'
});

function normalizeFilters(filters = {}) {
  const source = { ...DEFAULT_FILTERS, ...filters };
  return {
    level: ['all', 'N5', 'N4', 'N3', 'N2', 'N1', 'unranked'].includes(source.level) ? source.level : 'all',
    band: ['all', ...MEMORY_BANDS.map((item) => item.id), 'due', 'leech'].includes(source.band) ? source.band : 'all',
    pos: ['all', ...POS_BUCKETS.map((item) => item.id)].includes(source.pos) ? source.pos : 'all',
    search: String(source.search ?? '').trim(),
    sort: Object.prototype.hasOwnProperty.call(ORDER_SQL, source.sort) ? source.sort : 'level'
  };
}

function classifyPos(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return 'other';
  if (/サ变|サ変|する/.test(text)) return 'suru';
  if (/形容词|形容詞|形动|形動|^形$/.test(text)) return 'adj';
  if (/动词|動詞|他动|自动|他動|自動/.test(text)) return 'verb';
  if (/^名|^代名/.test(text)) return 'noun';
  if (/副词|副詞/.test(text)) return 'adv';
  if (/^代|連体|连体/.test(text)) return 'pron';
  if (/接尾|接頭|接头|^接|造|助$|助词|格助|終助|接助|助动/.test(text)) return 'affix';
  return 'other';
}

function rowsFor(db, sql, params = []) {
  return core.rowsFor(db, sql, params);
}

function ensureLibrarySchema(db) {
  // 收藏属于内容/个人意图，不应该被塞进 progress 或伪造一条 review。
  // 用 app_state 是为了沿用现有同步快照，不引入另一张两端不认识的表。
  db.run('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  core.ensureStudySchema(db);
}

function posRawValues(db, bucket) {
  if (bucket === 'all') return [];
  return rowsFor(db, 'SELECT DISTINCT pos FROM words WHERE pos IS NOT NULL').map((row) => String(row.pos ?? ''))
    .filter((raw) => classifyPos(raw) === bucket);
}

function baseWhere(db, filters) {
  const clauses = [];
  const params = [];
  if (filters.level === 'unranked') {
    clauses.push("(w.jlpt_level IS NULL OR w.jlpt_level NOT IN ('N5','N4','N3','N2','N1'))");
  } else if (filters.level !== 'all') {
    clauses.push('w.jlpt_level = ?');
    params.push(filters.level);
  }
  if (filters.pos !== 'all') {
    const values = posRawValues(db, filters.pos);
    if (!values.length) clauses.push('1 = 0');
    else {
      clauses.push(`w.pos IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    }
  }
  if (filters.search) {
    const like = `%${filters.search}%`;
    clauses.push('(w.kanji LIKE ? OR w.kana LIKE ? OR w.meaning LIKE ?)');
    params.push(like, like, like);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function whereFor(db, filters, dayEnd) {
  const base = baseWhere(db, filters);
  let extra = '';
  const extraParams = [];
  if (filters.band === 'due') {
    extra = DUE_SQL;
    extraParams.push(dayEnd);
  } else if (filters.band === 'leech') {
    extra = LEECH_SQL;
  } else if (filters.band !== 'all') {
    extra = `${BAND_SQL} = ?`;
    extraParams.push(filters.band);
  }
  return {
    sql: extra ? (base.sql ? `${base.sql} AND ${extra}` : `WHERE ${extra}`) : base.sql,
    params: [...base.params, ...extraParams]
  };
}

function toRow(row) {
  const pos = String(row.pos ?? '');
  const band = String(row.band ?? 'unseen');
  return {
    id: Number(row.id),
    kanji: String(row.kanji ?? ''),
    kana: String(row.kana ?? ''),
    meaning: String(row.meaning ?? ''),
    pos,
    posBucket: classifyPos(pos),
    level: String(row.jlpt_level ?? '') || '未分级',
    band,
    bandLabel: MEMORY_BANDS.find((item) => item.id === band)?.label || band,
    stability: row.fsrs_stability == null ? null : Number(row.fsrs_stability),
    dueAt: row.fsrs_due ? String(row.fsrs_due) : null,
    lastReview: row.fsrs_last_review ? String(row.fsrs_last_review) : null,
    lapses: Number(row.fsrs_lapses ?? 0),
    reps: Number(row.fsrs_reps ?? 0),
    isDue: Number(row.is_due ?? 0) === 1,
    isLeech: Number(row.fsrs_lapses ?? 0) >= 8,
    isKnownForever: Number(row.known_forever ?? 0) === 1,
    favorite: Number(row.favorite ?? 0) === 1
  };
}

function queryWordLibraryWithDb(db, inputFilters = {}, offset = 0, limit = 50) {
  ensureLibrarySchema(db);
  const filters = normalizeFilters(inputFilters);
  const dayEnd = core.studyDayEnd().toISOString();
  const where = whereFor(db, filters, dayEnd);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return rowsFor(db, `
    SELECT w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level,
           p.known_forever, p.seen_count, p.fsrs_stability, p.fsrs_due,
           p.fsrs_last_review, p.fsrs_lapses, p.fsrs_reps,
           ${BAND_SQL} AS band,
           CASE WHEN ${DUE_SQL} THEN 1 ELSE 0 END AS is_due,
           CASE WHEN s.value = '1' THEN 1 ELSE 0 END AS favorite
    FROM words w JOIN progress p ON p.word_id = w.id
    LEFT JOIN app_state s ON s.key = ('favorite:word:' || w.id)
    ${where.sql}
    ORDER BY ${ORDER_SQL[filters.sort]}
    LIMIT ? OFFSET ?
  `, [dayEnd, ...where.params, safeLimit, safeOffset]).map(toRow);
}

function tallyWordLibraryWithDb(db, inputFilters = {}) {
  ensureLibrarySchema(db);
  const filters = normalizeFilters(inputFilters);
  const dayEnd = core.studyDayEnd().toISOString();
  const where = baseWhere(db, filters);
  const bands = Object.fromEntries(MEMORY_BANDS.map((item) => [item.id, 0]));
  let total = 0;
  let due = 0;
  let leech = 0;
  rowsFor(db, `
    SELECT ${BAND_SQL} AS band, COUNT(*) AS n,
           SUM(CASE WHEN ${DUE_SQL} THEN 1 ELSE 0 END) AS due_n,
           SUM(CASE WHEN ${LEECH_SQL} THEN 1 ELSE 0 END) AS leech_n
    FROM words w JOIN progress p ON p.word_id = w.id
    ${where.sql}
    GROUP BY band
  `, [dayEnd, ...where.params]).forEach((row) => {
    const band = String(row.band ?? 'unseen');
    if (Object.prototype.hasOwnProperty.call(bands, band)) bands[band] = Number(row.n ?? 0);
    total += Number(row.n ?? 0);
    due += Number(row.due_n ?? 0);
    leech += Number(row.leech_n ?? 0);
  });
  return { total, bands, due, leech };
}

function wordLibraryDetailWithDb(db, wordId) {
  ensureLibrarySchema(db);
  const dayEnd = core.studyDayEnd().toISOString();
  const row = rowsFor(db, `
    SELECT w.id, w.kanji, w.kana, w.meaning, w.pos, w.verb_type, w.jlpt_level,
           w.example_jp, w.example_meaning, w.example_furigana, w.example_tokens,
           p.known_forever, p.seen_count, p.fsrs_stability, p.fsrs_due,
           p.fsrs_last_review, p.fsrs_lapses, p.fsrs_reps,
           ${BAND_SQL} AS band, CASE WHEN ${DUE_SQL} THEN 1 ELSE 0 END AS is_due,
           COALESCE(n.note, '') AS note,
           CASE WHEN s.value = '1' THEN 1 ELSE 0 END AS favorite
    FROM words w JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    LEFT JOIN app_state s ON s.key = ('favorite:word:' || w.id)
    WHERE w.id = ? LIMIT 1
  `, [dayEnd, wordId])[0];
  if (!row) return null;
  const result = toRow(row);
  return {
    ...result,
    verbType: String(row.verb_type ?? ''),
    example: { jp: String(row.example_jp ?? ''), meaning: String(row.example_meaning ?? '') },
    exampleFurigana: String(row.example_furigana ?? ''),
    exampleTokens: String(row.example_tokens ?? ''),
    note: String(row.note ?? ''),
    isFavorite: result.favorite
  };
}

function libraryIdsWithDb(db, inputFilters = {}, limit = 500) {
  ensureLibrarySchema(db);
  const filters = normalizeFilters(inputFilters);
  const dayEnd = core.studyDayEnd().toISOString();
  const where = whereFor(db, filters, dayEnd);
  return rowsFor(db, `
    SELECT w.id FROM words w JOIN progress p ON p.word_id = w.id
    ${where.sql} ORDER BY ${ORDER_SQL[filters.sort]} LIMIT ?
  `, [...where.params, Math.min(Math.max(Number(limit) || 500, 1), 500)]).map((row) => Number(row.id));
}

function withDb(task) {
  const db = databaseStore().getDatabase();
  return task(db);
}

function queryWordLibrary(filters, offset, limit) { return withDb((db) => queryWordLibraryWithDb(db, filters, offset, limit)); }
function tallyWordLibrary(filters) { return withDb((db) => tallyWordLibraryWithDb(db, filters)); }
function wordLibraryDetail(wordId) { return withDb((db) => wordLibraryDetailWithDb(db, wordId)); }
function wordLibraryIds(filters, limit) { return withDb((db) => libraryIdsWithDb(db, filters, limit)); }

async function toggleWordFavorite(wordId) {
  const { getDatabase, saveDatabase } = databaseStore();
  const db = getDatabase();
  ensureLibrarySchema(db);
  const key = `favorite:word:${Number(wordId)}`;
  const next = core.getState(db, key, '0') !== '1';
  core.setState(db, key, next ? '1' : '0');
  await saveDatabase();
  return next;
}

async function setWordsKnownForever(wordIds, known = true) {
  const { getDatabase, saveDatabase } = databaseStore();
  const db = getDatabase();
  ensureLibrarySchema(db);
  const ids = [...new Set((Array.isArray(wordIds) ? wordIds : [wordIds]).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return { count: 0, known };
  const day = core.localStudyDay(new Date());
  db.run('BEGIN TRANSACTION');
  try {
    for (const id of ids) {
      db.run('UPDATE progress SET known_forever = ?, mastered_on = ? WHERE word_id = ?', [known ? 1 : 0, known ? day : null, id]);
    }
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  await saveDatabase();
  return { count: ids.length, known };
}

module.exports = {
  MEMORY_BANDS,
  POS_BUCKETS,
  DEFAULT_FILTERS,
  classifyPos,
  normalizeFilters,
  ensureLibrarySchema,
  queryWordLibraryWithDb,
  tallyWordLibraryWithDb,
  wordLibraryDetailWithDb,
  libraryIdsWithDb,
  queryWordLibrary,
  tallyWordLibrary,
  wordLibraryDetail,
  wordLibraryIds,
  toggleWordFavorite,
  setWordsKnownForever
};
