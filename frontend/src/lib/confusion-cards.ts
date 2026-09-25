/**
 * 疑难辨析 Anki 卡：一个手写辨析组一张卡，进 FSRS（docs/MIXED_STUDY_PLAN.md 第 1 节）。
 *
 * 一张卡对应一组人工写明、标为不可互换的词：正面给词组，先回想核心差异；反面展示辨析稿。
 * 同义词组和可互换组不进队列，题面也不写情景提示。
 *
 * 哪些组能出：非 synonym 组、review level=major、词形唯一且有完整辨析稿。
 * 「已掌握」（confusion_mastered，用户手动标的）的组不进队列 —— 等于手动毕业，保留那张表。
 *
 * 存储同 kanji-char-cards：confusion_reviews 是事实，confusion_progress 是检查点，confusion_tasks 是当天投影。
 */
import type { WordAnswer } from "../types/vocabulary";
import { getDatabase } from "./database";
import { firstValue, rowsFor, today } from "./study-core";
import { ensureFsrsColumns, type FsrsEntity } from "./fsrs-store";
import { createCardLog, type StepMode } from "./card-log";
import { withoutSyncStamp } from "./sync/schema";
import { confusionGroups, displayForm, type ConfusionGroup } from "./confusion-groups";
import { distinctionNotesFor, distinctionReviewFor } from "../data/confusion_distinction_reviews";

export const CONFUSION_FSRS: FsrsEntity = {
  table: "confusion_progress",
  idColumn: "group_key",
  eligible: "known_forever = 0"
};

const sqlValue = (value: string): string => `'${value.replace(/'/gu, "''")}'`;
const eligibleGroupSql = (): string => {
  const keys = confusionGroups().filter(matchable).map((group) => group.key);
  return `group_key IN (${keys.map(sqlValue).join(",") || "NULL"})`;
};
const NOT_MASTERED = "group_key NOT IN (SELECT group_key FROM confusion_mastered)";

const log = createCardLog({
  entity: CONFUSION_FSRS,
  reviewsTable: "confusion_reviews",
  tasksTable: "confusion_tasks",
  extraExclude: () => `${eligibleGroupSql()} AND ${NOT_MASTERED}`
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
      last_seen_on TEXT,
      level_rank INTEGER NOT NULL DEFAULT 4
    )
  `);
  // 老库（level_rank 之前建的表）补列；默认 4 = N1，等 materialize 回填
  if (!rowsFor("PRAGMA table_info(confusion_progress)").some((row) => row.name === "level_rank")) {
    db.run("ALTER TABLE confusion_progress ADD COLUMN level_rank INTEGER NOT NULL DEFAULT 4");
  }
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

/** 仅收录核心用法确实不同的非同义组，词形重复或只是语气差别的组不出卡。 */
export const matchable = (group: ConfusionGroup): boolean => {
  const review = distinctionReviewFor(group.key);
  if (!review || review.level !== "major" || group.type === "synonym" || group.members.length < 2 || !review.summary.trim()) return false;
  const forms = new Set(group.members.map((member) => `${displayForm(member)}\u0000${member.kana}`));
  return forms.size === group.members.length;
};

const LEVEL_RANK: Record<string, number> = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };
/** 一组的等级 = 最难那个成员的等级：成员没学全就分不了，所以按最难的算。没等级的（自导词）当 N1。 */
export const groupLevelRank = (group: ConfusionGroup) => Math.max(...group.members.map((member) => LEVEL_RANK[member.jlptLevel] ?? 4));

/** 候选组 = 全部能出题的组。幂等：只补行、补等级。返回新补的组数。 */
export const materializeConfusionCards = (): number => {
  ensureConfusionCardTables();
  /*
   * ⚠️ 占位行和 level_rank 回填都不盖同步时间戳（理由同 word-api/bootstrap 的 initProgress）。
   * confusion_progress 是 lww：一行刚补出来的空占位（或只是重算了一下等级）时间戳是「现在」，
   * 比云端那条真练过的行新，合并之后会把对端的辨析卡进度静默盖掉。
   * level_rank 是从出厂内容算的，每台设备自己算得出同一个值，不需要靠同步传播。
   */
  const db = getDatabase();
  const existing = new Map(rowsFor("SELECT group_key, level_rank FROM confusion_progress").map((row) => [String(row.group_key), Number(row.level_rank)]));
  let inserted = 0;
  withoutSyncStamp(() => {
    db.run("BEGIN");
    try {
      for (const group of confusionGroups()) {
        if (!matchable(group)) continue;
        const rank = groupLevelRank(group);
        const current = existing.get(group.key);
        if (current === undefined) {
          db.run("INSERT INTO confusion_progress (group_key, level_rank) VALUES (?, ?)", [group.key, rank]);
          inserted += 1;
        } else if (current !== rank) {
          db.run("UPDATE confusion_progress SET level_rank = ? WHERE group_key = ?", [rank, group.key]);
        }
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  });
  return inserted;
};

export interface ConfusionCardMember {
  id: number;
  surface: string;
  kana: string;
  note?: string;
}

export interface MatchingCard {
  groupKey: string;
  type: ConfusionGroup["type"];
  label: string;
  members: ConfusionCardMember[];
  /** 总述只显示开头这句；逐词说明已拆到成员卡片上，避免整段重复四遍。 */
  overview: string;
  /** 反面：辨析稿总述 + 逐词注记（key 是 word id） */
  summary: string;
  notes: Map<string, string>;
}

export const matchingCard = (groupKey: string): MatchingCard | null => {
  const group = confusionGroups().find((item) => item.key === groupKey);
  const review = group ? distinctionReviewFor(group.key) : null;
  if (!group || !review || !matchable(group)) return null;
  const notes = distinctionNotesFor(review.summary, group.members.map((member) => ({
    key: String(member.id),
    forms: [displayForm(member), member.kanji, member.kana]
  })));
  return {
    groupKey: group.key,
    type: group.type,
    label: group.label,
    overview: review.summary.split(/[；;]/u)[0].trim(),
    members: group.members.map((member) => ({
      id: member.id,
      surface: displayForm(member),
      kana: member.kana,
      note: notes.get(String(member.id))
    })),
    summary: review.summary,
    notes
  };
};

/**
 * 当天清单：到期的 + 没见过的。新学优先给「成员里用户学过的词多」的组 —— 没学过的词连起来
 * 是在背题面，不是在辨析。
 */
export const createConfusionTasks = (quota: { fresh: number; review: number }, targetLevelRank = 4, day = today()) => {
  ensureConfusionCardTables();
  const eligible = new Set(confusionGroups().filter(matchable).map((group) => group.key));
  const existing = rowsFor("SELECT group_key FROM confusion_tasks WHERE reviewed_on = ?", [day]);
  if (existing.some((row) => !eligible.has(String(row.group_key)))) {
    // 旧版本的当日清单可能含同义组或可互换组。它只是投影，重建不会删除任何复习记录。
    getDatabase().run("DELETE FROM confusion_tasks WHERE reviewed_on = ?", [day]);
  }
  return log.createTasks(quota, () => {
    const learned = new Set(rowsFor("SELECT word_id FROM progress WHERE seen_count > 0").map((row) => Number(row.word_id)));
    const unseen = new Set(rowsFor(`SELECT group_key FROM confusion_progress WHERE ${log.exclude} AND seen_count = 0 AND level_rank <= ?`, [targetLevelRank]).map((row) => String(row.group_key)));
    return confusionGroups()
      .filter((group) => matchable(group))
      .filter((group) => unseen.has(group.key))
      .map((group) => ({ key: group.key, learned: group.members.filter((member) => learned.has(member.id)).length, size: group.members.length }))
      .sort((a, b) => b.learned - a.learned || a.size - b.size || a.key.localeCompare(b.key))
      .map((item) => item.key);
  }, day);
};

export const pickConfusionNext = (day = today(), excluded = new Set<string>()) => {
  ensureConfusionCardTables();
  const skip = new Set(excluded);
  const eligible = new Set(confusionGroups().filter(matchable).map((group) => group.key));
  for (let attempts = 0; attempts < 1000; attempts += 1) {
    const key = log.pickNext(day, skip);
    if (!key) return null;
    if (eligible.has(key)) return key;
    skip.add(key);
  }
  return null;
};
export const confusionCardProgress = (day = today()) => { ensureConfusionCardTables(); return log.progress(day); };
export const recordConfusionReview = (groupKey: string, answer: WordAnswer, now = new Date(), mode?: StepMode) => {
  ensureConfusionCardTables();
  return log.record(groupKey, answer, now, mode);
};
export const clearConfusionTasks = (day = today()) => { ensureConfusionCardTables(); log.clearTasks(day); };
export const undoLastConfusionReview = () => { ensureConfusionCardTables(); return log.undoLast(); };
export const replayConfusionReviews = (onlyKeys?: Iterable<string>) => { ensureConfusionCardTables(); return log.replay(onlyKeys); };

/** 池子：到期 + 目标等级内没学过的（给圆环）。 */
export const confusionCardPool = (targetLevelRank = 4) => {
  ensureConfusionCardTables();
  return {
    due: log.dueCount(),
    unseen: firstValue<number>(`SELECT COUNT(*) FROM confusion_progress WHERE ${log.exclude} AND seen_count = 0 AND level_rank <= ?`, [targetLevelRank], 0)
  };
};
