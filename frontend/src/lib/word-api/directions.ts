import { getDatabase } from "../database";
import { firstValue, rowsFor, today } from "../study-core";
import {
  ensureFsrsColumns,
  readFsrsState,
  writeFsrsState,
  KANJI_FSRS,
  REVERSE_FSRS,
  WORD_FSRS,
  type FsrsEntity
} from "../fsrs-store";
import {
  kanjiReadingPriorityAdjustment,
  shouldStudyKanjiReading
} from "../orthography";
import { LEECH_LAPSE_THRESHOLD } from "../fsrs-scheduler";

/**
 * 一个词 = 三张卡:正向(释义 → 日语)、反向(日语 → 释义)、汉字读音(表记 → 读音)。
 *
 * 三张卡挂同一个 word_id —— 词条、笔记、收藏、统计都是共享的,所以「熟练度」是互通的;
 * 但每张卡有**自己的一份 FSRS 状态**,各自的 due 只由各自方向的作答改写。
 * 于是「常规模式出哪些词,背没背反向都一样」是结构上成立的,不是靠约定。
 *
 * 三个方向此外没有任何差别:同一套到期集选词、同样的学习步骤和毕业判定、
 * 同样的每日上限、同样往 reviews 记流水(带 direction)。以前反向和汉字各有一套
 * temp_score / due_after 的土办法,那才是「有哪个模式特别」的来源。
 */
export type DirectionId = "forward" | "reverse" | "kanji_reading";

export interface StudyDirection {
  id: DirectionId;
  /** UI 用的阶段名(沿用历史叫法,学习页按它决定题面) */
  phase: string;
  /** 长期记忆表 */
  entity: FsrsEntity;
  /** 当日任务表 */
  taskTable: string;
  /** 哪些词有这个方向的卡(空 = 全部) */
  wordFilterSql: string;
  label: string;
}

export const FORWARD: StudyDirection = {
  id: "forward",
  phase: "stage1",
  entity: WORD_FSRS,
  taskTable: "stage1_tasks",
  wordFilterSql: "",
  label: "正向"
};

export const REVERSE: StudyDirection = {
  id: "reverse",
  phase: "stage2",
  entity: REVERSE_FSRS,
  taskTable: "stage2_progress",
  wordFilterSql: "",
  label: "反向"
};

export const KANJI: StudyDirection = {
  // phase/模式 ID 继续叫 kanji，避免打乱用户已经保存的模式选择；
  // reviews 的方向改用新 ID，让旧「释义 → 汉字」流水完整留在历史里。
  id: "kanji_reading",
  phase: "kanji",
  entity: KANJI_FSRS,
  taskTable: "kanji_reading_progress",
  // 汉字读音卡只对「写法和读音不同」的词有意义;更细的判断(真的含汉字、
  // 而且现代日语里确实写汉字)交给 shouldStudyKanjiReading,SQL 这道只是粗筛
  wordFilterSql: "w.kanji <> w.kana",
  label: "汉字"
};

export const DIRECTIONS: StudyDirection[] = [FORWARD, REVERSE, KANJI];

export const directionByPhase = (phase: string): StudyDirection =>
  DIRECTIONS.find((direction) => direction.phase === phase) ?? FORWARD;

export const directionAllowsWord = (
  direction: StudyDirection,
  word: { kanji?: unknown; kana?: unknown }
): boolean => direction.id !== "kanji_reading" || shouldStudyKanjiReading({
  kanji: String(word.kanji ?? ""),
  kana: String(word.kana ?? "")
});

export const filterDirectionWordIds = (direction: StudyDirection, wordIds: number[]): number[] => {
  if (direction.id !== "kanji_reading" || !wordIds.length) return wordIds;
  const placeholders = wordIds.map(() => "?").join(",");
  const allowed = new Set(rowsFor(`
    SELECT id, kanji, kana FROM words WHERE id IN (${placeholders})
  `, wordIds).filter((word) => directionAllowsWord(direction, word)).map((word) => Number(word.id)));
  return wordIds.filter((wordId) => allowed.has(wordId));
};

/**
 * 泛化代码要读的非 FSRS 计数列。汉字读音表与旧 kanji_memory 同构,
 * 没有 mistake_streak(会话内「连着错了几次」,决定要不要贴脸重复),这里补上。
 */
const COUNTER_COLS: [string, string][] = [
  ["seen_count", "INTEGER NOT NULL DEFAULT 0"],
  ["right_count", "INTEGER NOT NULL DEFAULT 0"],
  ["fuzzy_count", "INTEGER NOT NULL DEFAULT 0"],
  ["forgot_count", "INTEGER NOT NULL DEFAULT 0"],
  ["mistake_streak", "INTEGER NOT NULL DEFAULT 0"],
  ["last_seen_on", "TEXT"]
];

const countersReady = new WeakMap<object, Set<string>>();

export const ensureDirectionColumns = (direction: StudyDirection) => {
  const db = getDatabase();
  ensureFsrsColumns(direction.entity);
  let done = countersReady.get(db);
  if (!done) { done = new Set(); countersReady.set(db, done); }
  if (done.has(direction.entity.table)) return;
  const existing = new Set(
    rowsFor(`PRAGMA table_info(${direction.entity.table})`).map((row) => String(row.name ?? ""))
  );
  for (const [name, type] of COUNTER_COLS) {
    if (!existing.has(name)) db.run(`ALTER TABLE ${direction.entity.table} ADD COLUMN ${name} ${type}`);
  }
  done.add(direction.entity.table);
};

/** 新建的反向/汉字卡从正向状态折算多少稳定度:一半 */
export const SEEDED_STABILITY_RATIO = 0.5;

/**
 * 按需给「正向已经学过、这个方向还没有卡」的词建卡,一次最多 limit 个。
 *
 * 从正向状态**播种**而不是当全新卡:已经背熟的词,换个方向问也不至于一无所知,
 * 稳定度取一半当起点。全当新卡的话,几千个熟词会一次性变成新卡涌进来,
 * 第一次进反向就是一场灾难。
 *
 * due 设成现在:卡是因为「今天的新卡配额轮到它」才建出来的,建出来就该练。
 */
export const ensureDirectionCardIds = (direction: StudyDirection, limit: number): number[] => {
  if (direction.id === "forward" || limit <= 0) return [];
  ensureDirectionColumns(direction);
  const table = direction.entity.table;
  const rows = rowsFor(`
    SELECT p.word_id, p.fsrs_lapses, w.kanji, w.kana
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.seen_count > 0
      AND p.known_forever = 0
      AND COALESCE(p.fsrs_lapses, 0) < ?
      ${direction.wordFilterSql ? `AND ${direction.wordFilterSql}` : ""}
      AND NOT EXISTS (SELECT 1 FROM ${table} m WHERE m.word_id = p.word_id)
    ORDER BY p.fsrs_due ASC, p.word_id ASC
  `, [LEECH_LAPSE_THRESHOLD]).filter((row) => directionAllowsWord(direction, row));
  if (direction.id === "kanji_reading") {
    rows.sort((left, right) =>
      kanjiReadingPriorityAdjustment({
        kanji: String(right.kanji ?? ""), kana: String(right.kana ?? "")
      }) - kanjiReadingPriorityAdjustment({
        kanji: String(left.kanji ?? ""), kana: String(left.kana ?? "")
      })
    );
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  const createdIds: number[] = [];
  for (const row of rows) {
    if (createdIds.length >= limit) break;
    const wordId = Number(row.word_id);
    db.run(`INSERT OR IGNORE INTO ${table} (word_id, seen_count) VALUES (?, 0)`, [wordId]);
    const forward = readFsrsState(wordId, WORD_FSRS);
    if (forward) {
      writeFsrsState(wordId, {
        ...forward,
        // Keep the seed strictly below the source stability when possible.
        // A hard floor of 1 day made weak cards more stable after direction
        // seeding, which is the opposite of a conservative transfer.
        stability: Math.max(forward.stability * SEEDED_STABILITY_RATIO, 0.1),
        due: now,
        // 这个方向还没被真正问过,所以「上次复习」就是现在(播种时刻)
        lastReview: now,
        reps: 0,
        lapses: 0,
        steps: 0
      }, direction.entity);
    }
    createdIds.push(wordId);
  }
  return createdIds;
};

/** Backward-compatible count API for callers that only need a metric. */
export const ensureDirectionCards = (direction: StudyDirection, limit: number): number =>
  ensureDirectionCardIds(direction, limit).length;

/** 这个方向今天还有多少「从没练过」的卡可以引入(用来给新卡配额兜底) */
export const directionTaskCount = (direction: StudyDirection, day = today()) => firstValue<number>(
  `SELECT COUNT(*) FROM ${direction.taskTable} WHERE reviewed_on = ?`,
  [day],
  0
);
