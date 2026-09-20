/**
 * 疑难连线卡：一个辨析组一张卡，进 FSRS（docs/MIXED_STUDY_PLAN.md 第 1 节）。
 *
 * 正面是连线题：左列组内成员（词形按 displayForm），右列各自的题面（reviewedQuestionMeaning，
 * 和原来的辨析题同一口径）打乱；点左边一个再点右边一个就是一条线，不强制拖。
 * 反面是辨析稿（distinction_reviews 的 summary 和逐词注记）。
 *
 * 评分不让用户点四档，按结果算（`gradeMatching`）：一次全对 → 认识（第一次见就全对走 known → Easy，
 * 同词级路径）；错 1 条 → 模糊；错 ≥ 2 → 忘记。
 *
 * 哪些组能出：和原辨析题同一道闸（`reviewable`：有 major 级辨析稿、每个成员都有题面且首义不撞）。
 * 「已掌握」（confusion_mastered，用户手动标的）的组不进队列 —— 等于手动毕业，保留那张表。
 *
 * 存储同 kanji-char-cards：confusion_reviews 是事实，confusion_progress 是检查点，confusion_tasks 是当天投影。
 */
import type { WordAnswer } from "../types/vocabulary";
import { getDatabase } from "./database";
import { firstValue, rowsFor, today } from "./study-core";
import { ensureFsrsColumns, type FsrsEntity } from "./fsrs-store";
import { createCardLog, type StepMode } from "./card-log";
import { confusionGroups, displayForm, type ConfusionGroup } from "./confusion-groups";
import { distinctionNotesFor, distinctionReviewFor } from "../data/confusion_distinction_reviews";
import { reviewedQuestionMeaning } from "./models/question-meaning-overrides";

export const CONFUSION_FSRS: FsrsEntity = {
  table: "confusion_progress",
  idColumn: "group_key",
  eligible: "known_forever = 0"
};

const NOT_MASTERED = "group_key NOT IN (SELECT group_key FROM confusion_mastered)";

const log = createCardLog({
  entity: CONFUSION_FSRS,
  reviewsTable: "confusion_reviews",
  tasksTable: "confusion_tasks",
  extraExclude: NOT_MASTERED
});

export const ensureConfusionCardTables = (): void => {
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS confusion_progress (
      group_key TEXT PRIMARY KEY,
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
    CREATE TABLE IF NOT EXISTS confusion_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key TEXT NOT NULL,
      answer TEXT NOT NULL,
      reviewed_on TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      scheduler_mode TEXT NOT NULL DEFAULT 'normal',
      fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_confusion_reviews_group_on ON confusion_reviews (group_key, reviewed_on)");
  db.run(`
    CREATE TABLE IF NOT EXISTS confusion_tasks (
      reviewed_on TEXT NOT NULL,
      group_key TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (reviewed_on, group_key)
    )
  `);
  db.run("CREATE TABLE IF NOT EXISTS confusion_mastered (group_key TEXT PRIMARY KEY, mastered_on TEXT NOT NULL)");
  ensureFsrsColumns(CONFUSION_FSRS);
};

const firstSense = (text: string): string => text.split(/[；;]/)[0].trim();

/** 能出连线题的组：有 major 级辨析稿、每个成员都有审校过的题面、首义不撞。和原辨析题同一道闸。 */
export const matchable = (group: ConfusionGroup): boolean => {
  const review = distinctionReviewFor(group.key);
  if (!review || review.level !== "major" || group.members.length < 2) return false;
  const senses = new Set<string>();
  return group.members.every((member) => {
    const meaning = reviewedQuestionMeaning(member.kanji, member.kana);
    if (!meaning) return false;
    const sense = firstSense(meaning);
    if (senses.has(sense)) return false;
    senses.add(sense);
    return true;
  });
};

/** 候选组 = 全部能出题的组。幂等：只补行。返回新补的组数。 */
export const materializeConfusionCards = (): number => {
  ensureConfusionCardTables();
  const db = getDatabase();
  const existing = new Set(rowsFor("SELECT group_key FROM confusion_progress").map((row) => String(row.group_key)));
  let inserted = 0;
  db.run("BEGIN");
  try {
    for (const group of confusionGroups()) {
      if (existing.has(group.key) || !matchable(group)) continue;
      db.run("INSERT INTO confusion_progress (group_key) VALUES (?)", [group.key]);
      inserted += 1;
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  return inserted;
};

export interface MatchingPair {
  id: number;
  surface: string;
  kana: string;
  /** 右列的题面 */
  prompt: string;
}

export interface MatchingCard {
  groupKey: string;
  type: ConfusionGroup["type"];
  label: string;
  pairs: MatchingPair[];
  /** 反面：辨析稿总述 + 逐词注记（key 是 word id） */
  summary: string;
  notes: Map<string, string>;
}

export const matchingCard = (groupKey: string): MatchingCard | null => {
  const group = confusionGroups().find((item) => item.key === groupKey);
  const review = group ? distinctionReviewFor(group.key) : null;
  if (!group || !review || !matchable(group)) return null;
  return {
    groupKey: group.key,
    type: group.type,
    label: group.label,
    pairs: group.members.map((member) => ({
      id: member.id,
      surface: displayForm(member),
      kana: member.kana,
      prompt: reviewedQuestionMeaning(member.kanji, member.kana) ?? ""
    })),
    summary: review.summary,
    notes: distinctionNotesFor(review.summary, group.members.map((member) => ({
      key: String(member.id),
      forms: [displayForm(member), member.kanji, member.kana]
    })))
  };
};

/** 连线结果 → 四档里的一档。mistakes = 连错的次数（连错一条改对再算一条）。 */
export const gradeMatching = (mistakes: number): WordAnswer =>
  mistakes <= 0 ? "know" : mistakes === 1 ? "fuzzy" : "forgot";

/**
 * 当天清单：到期的 + 没见过的。新学优先给「成员里用户学过的词多」的组 —— 没学过的词连起来
 * 是在背题面，不是在辨析。
 */
export const createConfusionTasks = (quota: { fresh: number; review: number }, day = today()) => {
  ensureConfusionCardTables();
  return log.createTasks(quota, () => {
    const learned = new Set(rowsFor("SELECT word_id FROM progress WHERE seen_count > 0").map((row) => Number(row.word_id)));
    const unseen = new Set(rowsFor(`SELECT group_key FROM confusion_progress WHERE ${log.exclude} AND seen_count = 0`).map((row) => String(row.group_key)));
    return confusionGroups()
      .filter((group) => unseen.has(group.key))
      .map((group) => ({ key: group.key, learned: group.members.filter((member) => learned.has(member.id)).length, size: group.members.length }))
      .sort((a, b) => b.learned - a.learned || a.size - b.size || a.key.localeCompare(b.key))
      .map((item) => item.key);
  }, day);
};

export const pickConfusionNext = (day = today(), excluded = new Set<string>()) => { ensureConfusionCardTables(); return log.pickNext(day, excluded); };
export const confusionCardProgress = (day = today()) => { ensureConfusionCardTables(); return log.progress(day); };
export const recordConfusionReview = (groupKey: string, answer: WordAnswer, now = new Date(), mode?: StepMode) => {
  ensureConfusionCardTables();
  return log.record(groupKey, answer, now, mode);
};
export const replayConfusionReviews = (onlyKeys?: Iterable<string>) => { ensureConfusionCardTables(); return log.replay(onlyKeys); };

/** 池子：到期 + 没学过的（给圆环）。 */
export const confusionCardPool = () => {
  ensureConfusionCardTables();
  return {
    due: log.dueCount(),
    unseen: firstValue<number>(`SELECT COUNT(*) FROM confusion_progress WHERE ${log.exclude} AND seen_count = 0`, [], 0)
  };
};
