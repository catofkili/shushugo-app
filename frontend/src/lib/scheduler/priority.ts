/**
 * 单词推送优先级算法
 */

import { DbRow, daysSince } from "../database/db-utils";

const CRITICAL_SCORE = -20;

/**
 * 新词按当天尚未完成的比例随机穿插进旧词中。首张永远是旧词；
 * 临界旧词仍由调用方优先处理，避免随机新词抢占需要立即复习的内容。
 */
export const shouldPickStage1NewWord = (
  remainingReviewCount: number,
  remainingNewCount: number,
  completedTaskCount: number,
  randomValue = Math.random()
): boolean => {
  if (remainingNewCount <= 0) return false;
  if (remainingReviewCount <= 0) return true;
  if (completedTaskCount === 0) return false;
  return randomValue < remainingNewCount / (remainingReviewCount + remainingNewCount);
};

/**
 * 计算优先级组件
 */
export function priorityComponents(
  row: DbRow,
  dueAfter: number | undefined,
  criticalCount: number,
  newQuotaLeft: number
): Record<string, number> {
  const isNew = Number(row.seen_count ?? 0) === 0;
  const score = Number(row.score ?? 0);
  const components: Record<string, number> = {
    score: 0,
    critical: 0,
    importance: Number(row.importance ?? 3) * 7,
    mistake: Number(row.forgot_count ?? 0) * 14 + Number(row.fuzzy_count ?? 0) * 7 + Number(row.mistake_streak ?? 0) * 12 - Number(row.right_count ?? 0) * 3,
    queue: 0,
    age: Math.min(daysSince(row.last_seen_on) * 3, 30),
    review: isNew ? 0 : 35,
    new: 0,
    jitter: Math.random() * 8
  };

  if (isNew) {
    components.new = 45 + Math.min(newQuotaLeft, 10);
    components.score = 18;
    components.shuffle = Number(row.shuffle_rank ?? 0) * 18;
    components.importance = Number(row.importance ?? 3) * 4;
  } else {
    components.score = Math.max((10 - score) * 5, 0);
  }

  if (score <= CRITICAL_SCORE) {
    components.critical = 120 + Math.max(criticalCount - 3, 0) * 80;
  } else if (criticalCount > 3) {
    components.critical = -1000;
  }

  if (dueAfter !== undefined) {
    if (dueAfter <= 0) {
      components.queue = 45;
    } else {
      components.queue = -80 - dueAfter * 25;
    }
  }

  return components;
}

/**
 * 计算总优先级分数
 */
export function priorityScore(components: Record<string, number>): number {
  return Object.values(components).reduce((total, value) => total + value, 0);
}

/**
 * 临界词池大小
 */
export function criticalPoolSize(count: number): number {
  return Math.min(Math.max(count, 3), 5);
}

/**
 * 从 Stage1 任务中选择临界词池中的一个
 */
export function pickStage1CriticalPoolRow(rows: DbRow[], queueById: Map<number, number>): DbRow | null {
  const hasFloorWord = rows.some((row) => Number(row.score ?? 0) <= -40);
  if (!hasFloorWord) return null;
  const criticalRows = rows
    .filter((row) => Number(row.score ?? 0) <= CRITICAL_SCORE)
    .sort((left, right) => (
      Number(left.score ?? 0) - Number(right.score ?? 0)
      || Number(left.today_seen_count ?? 0) - Number(right.today_seen_count ?? 0)
      || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
    ));
  if (!criticalRows.length) return null;
  const pool = criticalRows.slice(0, criticalPoolSize(criticalRows.length));
  const duePool = pool.filter((row) => (queueById.get(Number(row.id)) ?? 0) <= 0);
  const selectable = duePool.length ? duePool : pool;
  return selectable.sort((left, right) => (
    (queueById.get(Number(left.id)) ?? 0) - (queueById.get(Number(right.id)) ?? 0)
    || Number(left.today_seen_count ?? 0) - Number(right.today_seen_count ?? 0)
    || Number(left.score ?? 0) - Number(right.score ?? 0)
    || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
  ))[0] ?? null;
}

/**
 * 从任意列表中选择临界词池中的一个（用于 Stage2/Kanji）
 */
export function pickDueCriticalPoolRow(rows: DbRow[], scoreKey = "score"): DbRow | null {
  const hasFloorWord = rows.some((row) => Number(row[scoreKey] ?? 0) <= -40);
  if (!hasFloorWord) return null;
  const criticalRows = rows
    .filter((row) => Number(row[scoreKey] ?? 0) <= CRITICAL_SCORE)
    .sort((left, right) => (
      Number(left[scoreKey] ?? 0) - Number(right[scoreKey] ?? 0)
      || Number(left.today_seen_count ?? left.seen_count ?? 0) - Number(right.today_seen_count ?? right.seen_count ?? 0)
      || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
    ));
  if (!criticalRows.length) return null;
  const pool = criticalRows.slice(0, criticalPoolSize(criticalRows.length));
  const duePool = pool.filter((row) => row.due_after == null || Number(row.due_after) <= 0);
  const selectable = duePool.length ? duePool : pool;
  return selectable.sort((left, right) => (
    Number(left.today_seen_count ?? left.seen_count ?? 0) - Number(right.today_seen_count ?? right.seen_count ?? 0)
    || Number(left[scoreKey] ?? 0) - Number(right[scoreKey] ?? 0)
    || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
  ))[0] ?? null;
}
