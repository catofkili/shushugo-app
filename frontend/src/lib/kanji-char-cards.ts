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
import { firstValue, rowsFor, studyDayEnd, today } from "./study-core";
import { ensureFsrsColumns, recordFsrsReview, type FsrsEntity } from "./fsrs-store";
import { STUBBORN_DAILY_MISTAKES } from "./fsrs-scheduler";
import { FSRS_PARAMS_VERSION } from "./reviews";
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

/**
 * 生成当天的清单：到期的（复习额度内）+ 没见过的（新学额度内，目标等级及以下，出现次数多的先）。
 * 同一天重复调用不重排；额度装不下到期集时随机抽（同 fsrsDueWordIds 那条，用户定的）。
 */
export const createKanjiCharTasks = (
  quota: { fresh: number; review: number },
  targetLevelRank: number,
  day = today()
): { fresh: number; review: number } => {
  ensureKanjiCharTables();
  const db = getDatabase();
  const existing = firstValue<number>("SELECT COUNT(*) FROM kanji_char_tasks WHERE reviewed_on = ?", [day], 0);
  if (existing > 0) {
    return {
      review: firstValue<number>("SELECT COUNT(*) FROM kanji_char_tasks t JOIN kanji_char_memory m ON m.char = t.char WHERE t.reviewed_on = ? AND m.seen_count > 0", [day], 0),
      fresh: firstValue<number>("SELECT COUNT(*) FROM kanji_char_tasks t JOIN kanji_char_memory m ON m.char = t.char WHERE t.reviewed_on = ? AND m.seen_count = 0", [day], 0)
    };
  }
  const dayEnd = studyDayEnd().toISOString();
  const due = rowsFor(`
    SELECT char FROM kanji_char_memory
    WHERE known_forever = 0 AND seen_count > 0 AND fsrs_due IS NOT NULL AND fsrs_due <= ?
    ORDER BY RANDOM() LIMIT ?
  `, [dayEnd, Math.max(0, quota.review)]).map((row) => String(row.char));
  // 出现次数多的字先学：覆盖收益最大。用 unit 索引里的 occurrenceCount 聚一下。
  const occurrence = new Map<string, number>();
  for (const unit of allKanjiUnits()) {
    if (unit.unitType === "char" && unit.char) occurrence.set(unit.char, (occurrence.get(unit.char) ?? 0) + unit.occurrenceCount);
  }
  const fresh = rowsFor(`
    SELECT char FROM kanji_char_memory
    WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ?
  `, [targetLevelRank])
    .map((row) => String(row.char))
    .sort((a, b) => (occurrence.get(b) ?? 0) - (occurrence.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, Math.max(0, quota.fresh));
  db.run("BEGIN");
  try {
    [...due, ...fresh].forEach((char, index) => {
      db.run("INSERT OR IGNORE INTO kanji_char_tasks (reviewed_on, char, order_index) VALUES (?, ?, ?)", [day, char, index]);
    });
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  return { review: due.length, fresh: fresh.length };
};

/** 当天还没毕业的下一张：due 仍在今天之内（或从没答过）的清单项，按 order_index。 */
export const pickKanjiCharNext = (day = today(), excluded = new Set<string>()): string | null => {
  ensureKanjiCharTables();
  const dayEnd = studyDayEnd().toISOString();
  const rows = rowsFor(`
    SELECT t.char, m.fsrs_due, m.fsrs_state
    FROM kanji_char_tasks t JOIN kanji_char_memory m ON m.char = t.char
    WHERE t.reviewed_on = ? AND m.known_forever = 0
    ORDER BY t.order_index
  `, [day]);
  for (const row of rows) {
    const char = String(row.char);
    if (excluded.has(char)) continue;
    // Learning / Relearning 一律不算毕业（同 isGraduatedForDay 那条）：那两个状态下 due 是下一个短期步骤
    const learning = row.fsrs_state != null && Number(row.fsrs_state) !== 2;
    const graduated = !learning && row.fsrs_due != null && String(row.fsrs_due) > dayEnd;
    if (!graduated) return char;
  }
  return null;
};

export const kanjiCharProgress = (day = today()) => {
  ensureKanjiCharTables();
  const dayEnd = studyDayEnd().toISOString();
  const total = firstValue<number>("SELECT COUNT(*) FROM kanji_char_tasks WHERE reviewed_on = ?", [day], 0);
  const done = firstValue<number>(`
    SELECT COUNT(*) FROM kanji_char_tasks t JOIN kanji_char_memory m ON m.char = t.char
    WHERE t.reviewed_on = ? AND (m.known_forever = 1 OR (m.fsrs_state = 2 AND m.fsrs_due > ?))
  `, [day, dayEnd], 0);
  return { total, done, remaining: Math.max(0, total - done) };
};

/** 池子大小（给圆环做段长压缩用）：到期 + 目标等级内没学过的。 */
export const kanjiCharPool = (targetLevelRank: number) => {
  ensureKanjiCharTables();
  const dayEnd = studyDayEnd().toISOString();
  return {
    due: firstValue<number>("SELECT COUNT(*) FROM kanji_char_memory WHERE known_forever = 0 AND seen_count > 0 AND fsrs_due <= ?", [dayEnd], 0),
    unseen: firstValue<number>("SELECT COUNT(*) FROM kanji_char_memory WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ?", [targetLevelRank], 0)
  };
};

const updateCounters = (char: string, answer: WordAnswer, seenOn: string): void => {
  const counts = answer === "forgot" ? [1, 0, 0, 1] : answer === "fuzzy" ? [1, 0, 1, 0] : [1, 1, 0, 0];
  const previousStreak = firstValue<number>("SELECT mistake_streak FROM kanji_char_memory WHERE char = ?", [char], 0);
  getDatabase().run(`
    UPDATE kanji_char_memory
    SET seen_count = seen_count + ?, right_count = right_count + ?, fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
        mistake_streak = ?, last_seen_on = ?
    WHERE char = ?
  `, [...counts, answer === "forgot" ? previousStreak + 1 : 0, seenOn, char]);
};

/** 同词级路径的三档：第一次见就答对 → known；今天错够次数 → stubborn；其余 normal。全部从流水现算，重放能原样重建。 */
export const kanjiCharStepMode = (char: string, answer: WordAnswer, day = today()): "normal" | "stubborn" | "known" => {
  const answeredToday = firstValue<number>("SELECT COUNT(*) FROM kanji_char_reviews WHERE char = ? AND reviewed_on = ?", [char, day], 0);
  if (answeredToday === 0 && (answer === "know" || answer === "known_forever")) return "known";
  const wrongToday = firstValue<number>(
    "SELECT COUNT(*) FROM kanji_char_reviews WHERE char = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')", [char, day], 0
  ) + (answer === "forgot" || answer === "fuzzy" ? 1 : 0);
  return wrongToday >= STUBBORN_DAILY_MISTAKES ? "stubborn" : "normal";
};

export const recordKanjiCharReview = (char: string, answer: WordAnswer, now = new Date(), mode?: "normal" | "stubborn" | "known") => {
  ensureKanjiCharTables();
  if (!firstValue<number>("SELECT COUNT(*) FROM kanji_char_memory WHERE char = ?", [char], 0)) throw new Error(`Unknown kanji char: ${char}`);
  mode ??= kanjiCharStepMode(char, answer);
  const fsrsAnswer: WordAnswer = answer === "known_forever" ? "know" : answer;
  const next = recordFsrsReview(char, fsrsAnswer, now, { mode }, KANJI_CHAR_FSRS);
  const seenOn = today();
  updateCounters(char, fsrsAnswer, seenOn);
  if (answer === "known_forever") getDatabase().run("UPDATE kanji_char_memory SET known_forever = 1 WHERE char = ?", [char]);
  getDatabase().run(`
    INSERT INTO kanji_char_reviews (char, answer, reviewed_on, reviewed_at, scheduler_mode, fsrs_params_version)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [char, answer, seenOn, now.getTime(), mode, FSRS_PARAMS_VERSION]);
  return next;
};

/** 合并之后从流水重建检查点（同 replayKanjiUnitReviews）。 */
export const replayKanjiCharReviews = (onlyChars?: Iterable<string>): number => {
  ensureKanjiCharTables();
  const chars = onlyChars
    ? [...new Set([...onlyChars])]
    : rowsFor("SELECT DISTINCT char FROM kanji_char_reviews").map((row) => String(row.char));
  const db = getDatabase();
  let replayed = 0;
  for (const char of chars) {
    const events = rowsFor("SELECT answer, reviewed_on, reviewed_at, scheduler_mode FROM kanji_char_reviews WHERE char = ? ORDER BY reviewed_at ASC, id ASC", [char]);
    if (!events.length) continue;
    // 流水里的字本机可能还没物化（对端先学到）：补一行再重放
    db.run("INSERT OR IGNORE INTO kanji_char_memory (char, level_rank) VALUES (?, 5)", [char]);
    db.run(`
      UPDATE kanji_char_memory
      SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0, mistake_streak = 0, known_forever = 0, last_seen_on = NULL,
          fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL, fsrs_last_review = NULL,
          fsrs_state = NULL, fsrs_steps = NULL, fsrs_reps = NULL, fsrs_lapses = NULL
      WHERE char = ?
    `, [char]);
    for (const event of events) {
      const answer = String(event.answer) as WordAnswer;
      if (!["forgot", "fuzzy", "know", "known_forever"].includes(answer)) continue;
      const at = Number(event.reviewed_at);
      const when = Number.isFinite(at) ? new Date(at) : new Date(`${String(event.reviewed_on)}T12:00:00`);
      const fsrsAnswer: WordAnswer = answer === "known_forever" ? "know" : answer;
      recordFsrsReview(char, fsrsAnswer, when, { mode: String(event.scheduler_mode ?? "normal") as "normal" | "stubborn" | "known" }, KANJI_CHAR_FSRS);
      updateCounters(char, fsrsAnswer, String(event.reviewed_on ?? today()));
      if (answer === "known_forever") db.run("UPDATE kanji_char_memory SET known_forever = 1 WHERE char = ?", [char]);
    }
    replayed += 1;
  }
  return replayed;
};
