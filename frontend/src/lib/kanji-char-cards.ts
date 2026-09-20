/**
 * 单独汉字卡：一个字一张卡，进 FSRS（docs/MIXED_STUDY_PLAN.md 第 1 节）。
 *
 * 正面一个字；反面音读 / 训读（KANJIDIC）、多音字的读音判据（kanji_reading_usage）、
 * 例词（这个字出现的词，按用户熟悉度排）。中文母语者认字不认音，所以考的是读音不是写法。
 *
 * ⚠️ 和 `kanji-unit-scheduler.ts`（按「一个字的一种读音」为单位、在旗子后面）不是一回事，
 * 也不动它；和「汉字读音」方向（词里遮住汉字那几拍）也不是一回事。三者的记忆各存各的。
 *
 * 存储和 kanji_unit 同一套：`kanji_char_reviews` 是唯一的事实（append，跨端按 sync_uid 合并），
 * `kanji_char_memory` 是本机检查点，合并之后由 `replayKanjiCharReviews` 从流水重建 ——
 * 两台设备同一天各答一次不会被 LWW 吃掉一次。
 */
import type { WordAnswer } from "../types/vocabulary";
import { getDatabase } from "./database";
import { firstValue, rowsFor, today } from "./study-core";
import { ensureFsrsColumns, type FsrsEntity } from "./fsrs-store";
import { FSRS_PARAMS_VERSION } from "./reviews";
import { createCardLog, type StepMode } from "./card-log";
import { allKanjiUnits, kanjiUnitIndexLoaded, kanjiUnitWordIds, loadKanjiUnitIndex } from "./kanji-unit-index";
import { kanjiReadingUsageFor, kanjiReadingUsageLoaded, loadKanjiReadingUsage, clauseText } from "./kanji-reading-usage";
import readingsPayload from "../data/kanji_readings.json";

export const KANJI_CHAR_FSRS: FsrsEntity = {
  table: "kanji_char_memory",
  idColumn: "char",
  eligible: "known_forever = 0"
};

const readings = (readingsPayload as { readings: Record<string, { on?: string[]; kun?: string[] }> }).readings;

export const loadKanjiCharData = () => Promise.all([loadKanjiUnitIndex(), loadKanjiReadingUsage()]).then(() => undefined);
export const kanjiCharDataLoaded = () => kanjiUnitIndexLoaded() && kanjiReadingUsageLoaded();

export const ensureKanjiCharTables = (): void => {
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS kanji_char_memory (
      char TEXT PRIMARY KEY,
      level_rank INTEGER NOT NULL DEFAULT 5,
      seen_count INTEGER NOT NULL DEFAULT 0,
      right_count INTEGER NOT NULL DEFAULT 0,
      fuzzy_count INTEGER NOT NULL DEFAULT 0,
      forgot_count INTEGER NOT NULL DEFAULT 0,
      mistake_streak INTEGER NOT NULL DEFAULT 0,
      known_forever INTEGER NOT NULL DEFAULT 0,
      last_seen_on TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kanji_char_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      char TEXT NOT NULL,
      answer TEXT NOT NULL,
      reviewed_on TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      scheduler_mode TEXT NOT NULL DEFAULT 'normal',
      fsrs_params_version TEXT NOT NULL DEFAULT '${FSRS_PARAMS_VERSION}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_kanji_char_reviews_char_on ON kanji_char_reviews (char, reviewed_on)");
  // 当天的物化清单，同 stage1_tasks：只是投影，不是源数据，快照里只带 14 天
  db.run(`
    CREATE TABLE IF NOT EXISTS kanji_char_tasks (
      reviewed_on TEXT NOT NULL,
      char TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (reviewed_on, char)
    )
  `);
  ensureFsrsColumns(KANJI_CHAR_FSRS);
};

/**
 * 候选字 = 词库里出现过的汉字（从读音单位索引聚出来），每个字记最低等级。
 * 幂等：只补行不改行。返回新补的字数。
 */
export const materializeKanjiChars = (): number => {
  ensureKanjiCharTables();
  const levelByChar = new Map<string, number>();
  for (const unit of allKanjiUnits()) {
    if (unit.unitType !== "char" || !unit.char) continue;
    const current = levelByChar.get(unit.char);
    if (current === undefined || unit.levelRank < current) levelByChar.set(unit.char, unit.levelRank);
  }
  const db = getDatabase();
  const existing = new Set(rowsFor("SELECT char FROM kanji_char_memory").map((row) => String(row.char)));
  let inserted = 0;
  db.run("BEGIN");
  try {
    for (const [char, levelRank] of levelByChar) {
      if (existing.has(char)) continue;
      db.run("INSERT INTO kanji_char_memory (char, level_rank) VALUES (?, ?)", [char, levelRank]);
      inserted += 1;
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  return inserted;
};

export interface KanjiCharExample {
  wordId: number;
  kanji: string;
  kana: string;
  meaning: string;
  level: string;
}

export interface KanjiCharCard {
  char: string;
  levelRank: number;
  on: string[];
  kun: string[];
  /** 多音字才有：每个读音一句「什么时候读它」 */
  usage: { base: string; kinds: string[]; note: string }[];
  examples: KanjiCharExample[];
}

const EXAMPLE_CAP = 6;

/** 反面内容。例词按「用户见过的次数」排，没学过的按重要度；全是已有数据的拼装，不新造内容。 */
export const kanjiCharCard = (char: string): KanjiCharCard | null => {
  const row = rowsFor("SELECT level_rank FROM kanji_char_memory WHERE char = ?", [char])[0];
  if (!row) return null;
  const wordIds = new Set<number>();
  for (const unit of allKanjiUnits()) {
    if (unit.unitType === "char" && unit.char === char) kanjiUnitWordIds(unit.unitKey).forEach((id) => wordIds.add(id));
  }
  const examples = wordIds.size
    ? rowsFor(`
        SELECT w.id, w.kanji, w.kana, w.meaning, w.jlpt_level, COALESCE(p.seen_count, 0) AS seen, COALESCE(w.importance, 0) AS importance
        FROM words w LEFT JOIN progress p ON p.word_id = w.id
        WHERE w.id IN (${[...wordIds].map(() => "?").join(",")})
        ORDER BY seen DESC, importance DESC, w.id ASC
        LIMIT ${EXAMPLE_CAP}
      `, [...wordIds]).map((word) => ({
        wordId: Number(word.id),
        kanji: String(word.kanji ?? ""),
        kana: String(word.kana ?? ""),
        meaning: String(word.meaning ?? ""),
        level: String(word.jlpt_level ?? "")
      }))
    : [];
  const dict = readings[char] ?? {};
  const usage = kanjiReadingUsageFor(char)?.readings.map((reading) => ({
    base: reading.base,
    kinds: reading.kinds,
    note: clauseText(reading)
  })) ?? [];
  return {
    char,
    levelRank: Number(row.level_rank),
    on: dict.on ?? [],
    kun: dict.kun ?? [],
    usage,
    examples
  };
};

const occurrenceByChar = () => {
  const occurrence = new Map<string, number>();
  for (const unit of allKanjiUnits()) {
    if (unit.unitType === "char" && unit.char) occurrence.set(unit.char, (occurrence.get(unit.char) ?? 0) + unit.occurrenceCount);
  }
  return occurrence;
};

const log = createCardLog({ entity: KANJI_CHAR_FSRS, reviewsTable: "kanji_char_reviews", tasksTable: "kanji_char_tasks" });

/**
 * 生成当天的清单：到期的（复习额度内，装不下随机抽）+ 没见过的（新学额度内，目标等级及以下，
 * 出现次数多的先 —— 覆盖收益最大）。同一天重复调用不重排。
 */
export const createKanjiCharTasks = (quota: { fresh: number; review: number }, targetLevelRank: number, day = today()) => {
  ensureKanjiCharTables();
  return log.createTasks(quota, () => {
    const occurrence = occurrenceByChar();
    return rowsFor("SELECT char FROM kanji_char_memory WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ?", [targetLevelRank])
      .map((row) => String(row.char))
      .sort((a, b) => (occurrence.get(b) ?? 0) - (occurrence.get(a) ?? 0) || a.localeCompare(b));
  }, day);
};

export const pickKanjiCharNext = (day = today(), excluded = new Set<string>()) => { ensureKanjiCharTables(); return log.pickNext(day, excluded); };
export const kanjiCharProgress = (day = today()) => { ensureKanjiCharTables(); return log.progress(day); };
export const kanjiCharStepMode = log.stepMode;
export const recordKanjiCharReview = (char: string, answer: WordAnswer, now = new Date(), mode?: StepMode) => { ensureKanjiCharTables(); return log.record(char, answer, now, mode); };
/** 撤销今天最后一次汉字作答（删流水 + 重放这个字）。 */
export const undoLastKanjiCharReview = () => { ensureKanjiCharTables(); return log.undoLast(); };
/** 合并之后从流水重建检查点。流水里有、本机没物化的字补一行（等级未知记 5）。 */
export const replayKanjiCharReviews = (onlyChars?: Iterable<string>) => {
  ensureKanjiCharTables();
  return log.replay(onlyChars, (char) => getDatabase().run("INSERT OR IGNORE INTO kanji_char_memory (char, level_rank) VALUES (?, 5)", [char]));
};

/** 池子大小（给圆环做段长压缩用）：到期 + 目标等级内没学过的。 */
export const kanjiCharPool = (targetLevelRank: number) => {
  ensureKanjiCharTables();
  return {
    due: log.dueCount(),
    unseen: firstValue<number>("SELECT COUNT(*) FROM kanji_char_memory WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ?", [targetLevelRank], 0)
  };
};
