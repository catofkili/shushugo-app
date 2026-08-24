/**
 * Phase 2 local-only unit scheduler.
 *
 * The existing WordCard/kanji mode can opt into this adapter through its local
 * feature flag. With the flag off, the old word-level direction remains the
 * safe fallback. Unit content is build-time data; memory is a local checkpoint
 * rebuilt from the append-only unit review log when sync merges arrive.
 */
import type { WordAnswer } from "../types/vocabulary";
import { getDatabase } from "./database";
import { firstValue, rowsFor, studyDayEnd, today } from "./study-core";
import { ensureFsrsColumns, recordFsrsReview, type FsrsEntity } from "./fsrs-store";
import {
  allKanjiUnits,
  kanjiUnitByKey,
  kanjiUnitExamples,
  kanjiUnitLevels,
  kanjiUnitsUpToLevel,
  kanjiUnitWordIds,
  loadKanjiUnitIndex,
  type KanjiUnitRecord
} from "./kanji-unit-index";
import { STUBBORN_DAILY_MISTAKES } from "./fsrs-scheduler";
import { FSRS_PARAMS_VERSION } from "./reviews";

export { loadKanjiUnitIndex };

export const KANJI_UNIT_SCHEDULER_FLAG = "feature.kanji_unit_scheduler_v1";

/**
 * 汉字模式的每日量**独立存**,不共用 `studyPreferences.dailyGoal`。
 * 共用的话改一个动全部 —— 而这两个模式的节奏本来就不一样。
 */
const DAILY_QUOTA_KEY = "kanji_unit_daily_quota";
const TARGET_LEVEL_KEY = "kanji_unit_target_level";
export const KANJI_UNIT_QUOTA_MIN = 5;
export const KANJI_UNIT_QUOTA_MAX = 200;
export const KANJI_UNIT_QUOTA_DEFAULT = 30;

const readState = (key: string): string | null => {
  try {
    return firstValue<string>("SELECT value FROM app_state WHERE key = ?", [key], "") || null;
  } catch {
    return null;
  }
};

/**
 * 用户选的是**总题量**(复习 + 新单位),不是新单位数。
 *
 * ⚠️ 没设过时必须走默认值。别写成 `Number(readState(...))` 再判 `isFinite` ——
 * `Number(null)` 是 **0** 不是 NaN,于是 isFinite 通过、被 clamp 成下限 5,
 * 默认值永远生效不了(实测:首次打开只给 5 张、ETA 报 1098 天)。
 */
export const getKanjiUnitDailyQuota = (): number => {
  const stored = readState(DAILY_QUOTA_KEY);
  if (stored === null) return KANJI_UNIT_QUOTA_DEFAULT;
  const raw = Number(stored);
  if (!Number.isFinite(raw) || raw <= 0) return KANJI_UNIT_QUOTA_DEFAULT;
  return Math.min(Math.max(Math.floor(raw), KANJI_UNIT_QUOTA_MIN), KANJI_UNIT_QUOTA_MAX);
};

export const setKanjiUnitDailyQuota = (quota: number): void => {
  const clamped = Math.min(Math.max(Math.floor(quota), KANJI_UNIT_QUOTA_MIN), KANJI_UNIT_QUOTA_MAX);
  getDatabase().run(`
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [DAILY_QUOTA_KEY, String(clamped)]);
};

/** 目标级别序号(0=N5 … 4=N1)。软排序:超纲只降权,不排除。默认 N1 = 全都学。 */
export const KANJI_UNIT_TARGET_DEFAULT = 4;

export const getKanjiUnitTargetLevelRank = (): number => {
  const stored = readState(TARGET_LEVEL_KEY);
  if (stored === null) return KANJI_UNIT_TARGET_DEFAULT;
  const raw = Number(stored);
  if (!Number.isFinite(raw)) return KANJI_UNIT_TARGET_DEFAULT;
  return Math.min(Math.max(Math.floor(raw), 0), 4);
};

export const setKanjiUnitTargetLevelRank = (rank: number): void => {
  getDatabase().run(`
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [TARGET_LEVEL_KEY, String(Math.min(Math.max(Math.floor(rank), 0), 4))]);
};

/**
 * 一个新单位一生大约要做多少次(FSRS 学习步骤 + 到达长间隔前的复习)。
 *
 * 用来把「总题量」换算成「实际能引入多少新单位」。没有这一步,选择界面上写的
 * 「每天 20」和实际体验会差出三倍 —— 那是「点开给 4 张」的反向重演。
 * 取值按现有 FSRS 参数下的稳态估计,偏保守。
 */
export const REVIEWS_PER_NEW_UNIT = 9;

export interface KanjiUnitEtaRow {
  levelRank: number;
  level: string;
  /** 到这一级累计需要掌握的单位数 */
  unitsNeeded: number;
  /** 还欠多少 */
  unitsRemaining: number;
  /** 按当前总题量估算的天数 */
  days: number;
}

/**
 * 「按现在的每日量,多久能读到 N 几」。
 *
 * 稳态下每天的总题量被复习吃掉一部分,剩下的才是新单位:
 *   newPerDay ≈ quota / REVIEWS_PER_NEW_UNIT
 * 这是**估算**,不是承诺:实际速度取决于答对率(错得多则复习占比更高)。
 */
export const kanjiUnitEta = (quota = getKanjiUnitDailyQuota()): KanjiUnitEtaRow[] => {
  const levels = kanjiUnitLevels();
  const learned = new Set(rowsFor(
    "SELECT unit_key FROM kanji_unit_memory WHERE COALESCE(seen_count, 0) > 0"
  ).map((row) => String(row.unit_key)));
  const newPerDay = Math.max(quota / REVIEWS_PER_NEW_UNIT, 0.1);
  return levels.map((level, levelRank) => {
    const scope = kanjiUnitsUpToLevel(levelRank);
    const remaining = scope.filter((unit) => !learned.has(unit.unitKey)).length;
    return {
      levelRank,
      level,
      unitsNeeded: scope.length,
      unitsRemaining: remaining,
      days: Math.ceil(remaining / newPerDay)
    };
  });
};

/**
 * 默认**开**。UI 适配(WordStudy 的 unitKey / unitTarget 分支)已经就位,
 * 单位队列才是汉字模式现在唯一说得通的口径 —— 旧的词级队列只排「今天恰好到期的」,
 * 牌堆小的时候就是 0。
 *
 * 显式写入 "0" 仍可退回旧路径:出问题时这是不用发版的逃生门。
 */
export const isKanjiUnitSchedulerEnabled = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(KANJI_UNIT_SCHEDULER_FLAG) !== "0";
  } catch {
    return true;
  }
};

export const setKanjiUnitSchedulerEnabled = (enabled: boolean): void => {
  try {
    globalThis.localStorage?.setItem(KANJI_UNIT_SCHEDULER_FLAG, enabled ? "1" : "0");
  } catch {
    // Storage may be unavailable in an isolated test or native startup path.
  }
};

export const KANJI_UNIT_FSRS: FsrsEntity = {
  table: "kanji_unit_memory",
  idColumn: "unit_key",
  eligible: "1 = 1"
};

export interface KanjiUnitCard {
  unit: KanjiUnitRecord;
  exampleWordId: number;
  exampleWord: Record<string, unknown>;
  targetSegment: { start: number; length: number; text: string };
  actualReading: string;
  variant: string;
}

/** View-model boundary for the future UI; it does not alter the old WordCard. */
export const kanjiUnitCardByKey = (unitKey: string, exampleIndex = 0): KanjiUnitCard | null => {
  const unit = kanjiUnitByKey(unitKey);
  const example = kanjiUnitExamples(unitKey)[exampleIndex];
  if (!unit || !example) return null;
  const word = rowsFor("SELECT * FROM words WHERE id = ?", [example.wordId])[0];
  if (!word) return null;
  // 切段文本不进索引:由词表面按 start/length 现切,省下运行时索引里的一整列
  const surface = String(word.kanji ?? "");
  return {
    unit,
    exampleWordId: example.wordId,
    exampleWord: word,
    targetSegment: {
      start: example.start,
      length: example.length,
      text: surface.slice(example.start, example.start + example.length)
    },
    actualReading: example.reading,
    variant: example.variant
  };
};

const ensureColumns = (table: string, columns: Record<string, string>) => {
  const existing = new Set(rowsFor(`PRAGMA table_info(${table})`).map((row) => String(row.name ?? "")));
  const db = getDatabase();
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
};

export const ensureKanjiUnitTables = (): void => {
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS kanji_units (
      unit_id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL UNIQUE,
      unit_type TEXT NOT NULL,
      char TEXT NOT NULL DEFAULT '',
      base TEXT NOT NULL DEFAULT '',
      surface TEXT NOT NULL DEFAULT '',
      reading TEXT NOT NULL DEFAULT '',
      kinds TEXT NOT NULL DEFAULT '[]',
      CHECK (
        (unit_type = 'char' AND char <> '' AND base <> '' AND surface = '' AND reading = '')
        OR (unit_type = 'jukujikun' AND char = '' AND base = '' AND surface <> '' AND reading <> '')
      )
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kanji_unit_memory (
      unit_key TEXT PRIMARY KEY,
      seen_count INTEGER NOT NULL DEFAULT 0,
      right_count INTEGER NOT NULL DEFAULT 0,
      fuzzy_count INTEGER NOT NULL DEFAULT 0,
      forgot_count INTEGER NOT NULL DEFAULT 0,
      mistake_streak INTEGER NOT NULL DEFAULT 0,
      last_seen_on TEXT,
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kanji_unit_flags (
      unit_key TEXT PRIMARY KEY,
      known_forever INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kanji_unit_tasks (
      reviewed_on TEXT NOT NULL,
      unit_key TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (reviewed_on, unit_key),
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kanji_unit_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL,
      answer TEXT NOT NULL,
      reviewed_on TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      scheduler_mode TEXT NOT NULL DEFAULT 'normal',
      fsrs_params_version TEXT NOT NULL DEFAULT '${FSRS_PARAMS_VERSION}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `);
  ensureColumns("kanji_unit_memory", {
    fsrs_stability: "REAL",
    fsrs_difficulty: "REAL",
    fsrs_due: "TEXT",
    fsrs_last_review: "TEXT",
    fsrs_state: "INTEGER",
    fsrs_steps: "INTEGER",
    fsrs_reps: "INTEGER",
    fsrs_lapses: "INTEGER"
  });
  ensureFsrsColumns(KANJI_UNIT_FSRS);
};

/**
 * Materialise content only; it never creates a review or infers memory.
 *
 * 单事务 + 只数一次总量。原来每个单位先 `SELECT COUNT(*)` 再插两张表 ——
 * 3,278 个单位 = 3,278 次查询 + 6,556 次写,首次进模式会明显卡住。
 * 现在只在首尾各数一次,插入本身交给 `INSERT OR IGNORE`。
 */
export const materializeKanjiUnitIndex = (): number => {
  ensureKanjiUnitTables();
  const units = allKanjiUnits();
  if (!units.length) return 0;
  const db = getDatabase();
  const before = firstValue<number>("SELECT COUNT(*) FROM kanji_units", [], 0);
  if (before >= units.length) return 0;
  // 外层可能已经在事务里(同步合并、持久化都会包一层),嵌套 BEGIN 会抛
  // 「cannot start a transaction within a transaction」。首页读 stats 的地方
  // 外面包着 `catch { return; }`,抛出去就是**首页永远停在加载态**,所以这里
  // 自己判断能不能开事务,开不了就直接插 —— 慢一点,但不会把整页拖垮。
  let owned = false;
  try {
    db.run("BEGIN");
    owned = true;
  } catch {
    owned = false;
  }
  try {
    for (const unit of units) {
      db.run(`
        INSERT OR IGNORE INTO kanji_units
          (unit_key, unit_type, char, base, surface, reading, kinds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [unit.unitKey, unit.unitType, unit.char, unit.base, unit.surface, unit.reading, JSON.stringify(unit.kinds)]);
      db.run("INSERT OR IGNORE INTO kanji_unit_memory (unit_key) VALUES (?)", [unit.unitKey]);
    }
    if (owned) db.run("COMMIT");
  } catch (error) {
    if (owned) db.run("ROLLBACK");
    throw error;
  }
  return firstValue<number>("SELECT COUNT(*) FROM kanji_units", [], 0) - before;
};

/**
 * 覆盖收益 —— 「这个单位现在有多必要学」。
 *
 * 四项分开算,别再往里塞魔法数字(同 priority.ts 那条教训)。
 *
 * ⚠️ 上一版把 `unseen`(例词里用户**没学过**的数量)加权 +3,方向是反的:
 * 越是没学过的词越优先,而「不给没学过意思的词考读音」正是这套设计的前提。
 * 实测它当时几乎没造成差别(前 100 与纯产量重合 96/100),但用户学得越多偏得越厉害。
 * 现在换成报告里的 w2:**边际完成数** —— 学会它之后能读全几个词。
 *
 * 重要度改成**均值**:原来对每个例词累加,而产量项已经算过一次,
 * 等于让重要度被产量二次放大。
 */
export interface CoverageContext {
  /** word_id → 这个词的元数据 */
  wordMeta: Map<number, { seen: number; importance: number }>;
  /** 已经掌握(或已在计划里)的单位,用来算边际完成数 */
  knownUnits: Set<string>;
  /** word_id → 这个词需要的全部单位 */
  unitsByWord: Map<number, string[]>;
  /** 目标级别序号;软排序 —— 超纲的不排除,只降权 */
  targetLevelRank: number;
}

const LEVEL_PENALTY = 6;

export const coverageScore = (unitKey: string, context: CoverageContext): number => {
  const unit = kanjiUnitByKey(unitKey);
  if (!unit) return 0;
  const wordIds = kanjiUnitWordIds(unitKey);

  // w1 原始产量:出现在多少个词里
  const yield_ = wordIds.length;

  // w2 边际完成数:学会它之后,有几个词的全部单位都齐了
  let marginal = 0;
  let importanceSum = 0;
  for (const wordId of wordIds) {
    importanceSum += context.wordMeta.get(wordId)?.importance ?? 0;
    const needed = context.unitsByWord.get(wordId);
    if (!needed) continue;
    if (needed.every((key) => key === unitKey || context.knownUnits.has(key))) marginal += 1;
  }

  // w3 重要度(均值,不随产量放大)
  const importance = wordIds.length ? importanceSum / wordIds.length : 0;

  // w4 级别:软排序。目标之内不罚;每超纲一级扣固定分,超得多的自然沉底,
  //     但产量足够高时仍然出得来 —— 这就是「软」的含义。
  const overshoot = Math.max(unit.levelRank - context.targetLevelRank, 0);

  return yield_ + marginal * 3 + importance * 0.5 - overshoot * LEVEL_PENALTY;
};

/** 词 → 它需要的全部单位。覆盖收益的 w2 要用,按索引现算一次即可。 */
export const buildUnitsByWord = (): Map<number, string[]> => {
  const map = new Map<number, string[]>();
  for (const unit of allKanjiUnits()) {
    for (const wordId of kanjiUnitWordIds(unit.unitKey)) {
      const list = map.get(wordId);
      if (list) list.push(unit.unitKey);
      else map.set(wordId, [unit.unitKey]);
    }
  }
  return map;
};

export interface KanjiUnitPlan {
  units: string[];
  /** 今天排进来的到期复习数 */
  reviewCount: number;
  /** 今天排进来的新单位数 */
  newCount: number;
  /**
   * 弱提示:复习把总题量占满了,新单位一个都排不进来。
   * 不硬拦 —— 只是告诉用户「今天没推进度」,想推可以临时调高总题量。
   */
  crowdedOut: boolean;
}

/**
 * 排当天的计划。**总题量口径**:用户选的是一天做多少题,不是引入多少新单位。
 *
 * 顺序是「到期复习优先,剩下的名额给新单位」。**剩余名额必须真的用掉** ——
 * 旧实现只取到期的,牌堆小的时候到期量天然稀疏,于是出现「点开一天给你 4 张」。
 * 补满不是可选项:牌堆只要不够大,不补就必然给不满。
 */
export const createKanjiUnitTasks = (
  day = today(),
  limit = getKanjiUnitDailyQuota(),
  targetLevelRank = getKanjiUnitTargetLevelRank()
): KanjiUnitPlan => {
  if (limit <= 0) return { units: [], reviewCount: 0, newCount: 0, crowdedOut: false };
  materializeKanjiUnitIndex();
  const db = getDatabase();
  const existing = rowsFor("SELECT unit_key FROM kanji_unit_tasks WHERE reviewed_on = ? ORDER BY order_index", [day])
    .map((row) => String(row.unit_key));
  if (existing.length) {
    const seen = new Set(rowsFor(`
      SELECT t.unit_key FROM kanji_unit_tasks t
      JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
      WHERE t.reviewed_on = ? AND COALESCE(m.seen_count, 0) > 0
    `, [day]).map((row) => String(row.unit_key)));
    return {
      units: existing,
      reviewCount: existing.filter((key) => seen.has(key)).length,
      newCount: existing.filter((key) => !seen.has(key)).length,
      crowdedOut: false
    };
  }

  const wordMeta = new Map<number, { seen: number; importance: number }>();
  rowsFor(`
    SELECT w.id, COALESCE(w.importance, 0) AS importance, COALESCE(p.seen_count, 0) AS seen
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
  `).forEach((row) => wordMeta.set(Number(row.id), {
    seen: Number(row.seen ?? 0),
    importance: Number(row.importance ?? 0)
  }));
  const unitsByWord = buildUnitsByWord();

  // 已练过的单位算「已会」,用来给边际完成数打底
  const knownUnits = new Set(rowsFor(
    "SELECT unit_key FROM kanji_unit_memory WHERE COALESCE(seen_count, 0) > 0"
  ).map((row) => String(row.unit_key)));
  const context: CoverageContext = { wordMeta, knownUnits, unitsByWord, targetLevelRank };
  const byScore = (left: string, right: string) =>
    (coverageScore(right, context) - coverageScore(left, context)) || left.localeCompare(right, "ja");

  // 1. 到期复习优先占用总题量
  const due = rowsFor(`
    SELECT m.unit_key
    FROM kanji_unit_memory m
    LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
    WHERE COALESCE(f.known_forever, 0) = 0
      AND COALESCE(m.seen_count, 0) > 0
      AND (m.fsrs_due IS NULL OR m.fsrs_due <= ?)
  `, [studyDayEnd().toISOString()]).map((row) => String(row.unit_key)).sort(byScore);
  const reviews = due.slice(0, limit);

  // 2. 剩余名额给新单位 —— 按覆盖收益排,软排序下超纲的只是降权不是排除
  const remaining = Math.max(limit - reviews.length, 0);
  const fresh = remaining > 0
    ? rowsFor(`
        SELECT m.unit_key
        FROM kanji_unit_memory m
        LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
        WHERE COALESCE(f.known_forever, 0) = 0
          AND COALESCE(m.seen_count, 0) = 0
      `).map((row) => String(row.unit_key)).sort(byScore).slice(0, remaining)
    : [];

  const selected = [...reviews, ...fresh];
  selected.forEach((unitKey, position) => db.run(`
    INSERT OR IGNORE INTO kanji_unit_tasks (reviewed_on, unit_key, order_index)
    VALUES (?, ?, ?)
  `, [day, unitKey, position + 1]));
  return {
    units: selected,
    reviewCount: reviews.length,
    newCount: fresh.length,
    // 还有新单位可学,却因为复习占满而一个都没排进来
    crowdedOut: fresh.length === 0 && reviews.length >= limit && hasUnlearnedKanjiUnits()
  };
};

const hasUnlearnedKanjiUnits = (): boolean => firstValue<number>(`
  SELECT COUNT(*) FROM kanji_unit_memory m
  LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
  WHERE COALESCE(f.known_forever, 0) = 0 AND COALESCE(m.seen_count, 0) = 0
`, [], 0) > 0;

export const pickKanjiUnitNext = (day = today(), excluded = new Set<string>()): string | null => {
  ensureKanjiUnitTables();
  const rows = rowsFor(`
    SELECT t.unit_key
    FROM kanji_unit_tasks t
    JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
    LEFT JOIN kanji_unit_flags f ON f.unit_key = t.unit_key
    WHERE t.reviewed_on = ?
      AND COALESCE(f.known_forever, 0) = 0
      AND (m.fsrs_due IS NULL OR m.fsrs_due <= ?)
    ORDER BY t.order_index ASC
  `, [day, new Date().toISOString()]);
  return rows.map((row) => String(row.unit_key)).find((unitKey) => !excluded.has(unitKey)) ?? null;
};

export const kanjiUnitProgress = (day = today()) => {
  ensureKanjiUnitTables();
  const end = studyDayEnd();
  // 没排过就先排。首页要显示的是「今天能练多少」,只读任务表的话当天第一次打开
  // 永远是 0 —— 而计划本来就该在当天第一次问到它的时候生成(同 stage1 的口径)。
  // 和旧的词级路径不同,这里排的是**补满到总题量**的计划,不是「今天恰好到期几张」。
  createKanjiUnitTasks(day);
  const total = firstValue<number>("SELECT COUNT(*) FROM kanji_unit_tasks WHERE reviewed_on = ?", [day], 0);
  const completed = firstValue<number>(`
    SELECT COUNT(*)
    FROM kanji_unit_tasks t
    JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
    LEFT JOIN kanji_unit_flags f ON f.unit_key = t.unit_key
    WHERE t.reviewed_on = ?
      AND (COALESCE(f.known_forever, 0) = 1 OR m.fsrs_due > ?)
  `, [day, end.toISOString()], 0);
  return { total, completed: Math.min(total, completed) };
};

const updateKanjiUnitCounters = (unitKey: string, answer: WordAnswer, seenOn: string): void => {
  const counts = answer === "know"
    ? [1, 1, 0, 0]
    : answer === "fuzzy"
      ? [1, 0, 1, 0]
      : [1, 0, 0, 1];
  const previousStreak = firstValue<number>("SELECT mistake_streak FROM kanji_unit_memory WHERE unit_key = ?", [unitKey], 0);
  const nextStreak = answer === "forgot" ? previousStreak + 1 : 0;
  getDatabase().run(`
    UPDATE kanji_unit_memory
    SET seen_count = seen_count + ?, right_count = right_count + ?,
        fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
        mistake_streak = ?, last_seen_on = ?
    WHERE unit_key = ?
  `, [...counts, nextStreak, seenOn, unitKey]);
};

/**
 * 这一次作答该走哪档学习步骤 —— 和词级路径同口径(`direction-answer.ts`):
 *   第一次见就答对 → known(直接毕业,不走中间步骤)
 *   今天已经错够次数 → stubborn(贴脸重复)
 *   其余 → normal
 *
 * 判据全部从单位自己的作答流水现算,所以重放时能原样重建 —— 不另存计数器。
 */
export const kanjiUnitStepMode = (
  unitKey: string,
  answer: WordAnswer,
  day = today()
): "normal" | "stubborn" | "known" => {
  const answeredToday = firstValue<number>(
    "SELECT COUNT(*) FROM kanji_unit_reviews WHERE unit_key = ? AND reviewed_on = ?",
    [unitKey, day],
    0
  );
  if (answeredToday === 0 && answer === "know") return "known";
  const wrongToday = firstValue<number>(
    `SELECT COUNT(*) FROM kanji_unit_reviews
     WHERE unit_key = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')`,
    [unitKey, day],
    0
  ) + (answer === "forgot" || answer === "fuzzy" ? 1 : 0);
  return wrongToday >= STUBBORN_DAILY_MISTAKES ? "stubborn" : "normal";
};

export const recordKanjiUnitReview = (
  unitKey: string,
  answer: WordAnswer,
  now = new Date(),
  mode?: "normal" | "stubborn" | "known"
) => {
  ensureKanjiUnitTables();
  const exists = firstValue<number>("SELECT COUNT(*) FROM kanji_units WHERE unit_key = ?", [unitKey], 0);
  if (!exists) throw new Error(`Unknown kanji unit: ${unitKey}`);
  mode ??= kanjiUnitStepMode(unitKey, answer);
  const next = recordFsrsReview(unitKey, answer, now, { mode }, KANJI_UNIT_FSRS);
  const seenOn = today();
  updateKanjiUnitCounters(unitKey, answer, seenOn);
  getDatabase().run(`
    INSERT INTO kanji_unit_reviews
      (unit_key, answer, reviewed_on, reviewed_at, scheduler_mode, fsrs_params_version)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [unitKey, answer, seenOn, now.getTime(), mode, FSRS_PARAMS_VERSION]);
  return next;
};

/** Rebuild unit checkpoints from the append-only event log after a merge. */
export const replayKanjiUnitReviews = (onlyUnitKeys?: Iterable<string>): number => {
  ensureKanjiUnitTables();
  const keys = onlyUnitKeys
    ? [...new Set([...onlyUnitKeys])]
    : rowsFor("SELECT DISTINCT unit_key FROM kanji_unit_reviews").map((row) => String(row.unit_key));
  let replayed = 0;
  for (const unitKey of keys) {
    const events = rowsFor(`
      SELECT answer, reviewed_on, reviewed_at, scheduler_mode
      FROM kanji_unit_reviews
      WHERE unit_key = ?
      ORDER BY reviewed_at ASC, id ASC
    `, [unitKey]);
    if (!events.length) continue;
    getDatabase().run(`
      UPDATE kanji_unit_memory
      SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
          mistake_streak = 0, last_seen_on = NULL,
          fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL,
          fsrs_last_review = NULL, fsrs_state = NULL, fsrs_steps = NULL,
          fsrs_reps = NULL, fsrs_lapses = NULL
      WHERE unit_key = ?
    `, [unitKey]);
    for (const event of events) {
      const answer = String(event.answer) as WordAnswer;
      if (answer !== "forgot" && answer !== "fuzzy" && answer !== "know") continue;
      const at = Number(event.reviewed_at);
      const when = Number.isFinite(at) ? new Date(at) : new Date(`${String(event.reviewed_on)}T12:00:00`);
      recordFsrsReview(unitKey, answer, when, {
        mode: String(event.scheduler_mode ?? "normal") as "normal" | "stubborn" | "known"
      }, KANJI_UNIT_FSRS);
      updateKanjiUnitCounters(unitKey, answer, String(event.reviewed_on ?? today()));
    }
    replayed += 1;
  }
  return replayed;
};

export const setKanjiUnitKnownForever = (unitKey: string, knownForever: boolean): void => {
  ensureKanjiUnitTables();
  getDatabase().run(`
    INSERT INTO kanji_unit_flags (unit_key, known_forever, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(unit_key) DO UPDATE SET known_forever = excluded.known_forever, updated_at = excluded.updated_at
  `, [unitKey, knownForever ? 1 : 0]);
};
