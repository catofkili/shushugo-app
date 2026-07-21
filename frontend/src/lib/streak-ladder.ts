/**
 * 连胜梯子(间隔扩张)算法核心 —— 与 japanese-learning-app/server.py 保持逐行对应。
 *
 * 旧机制的问题:全体词每天平扣 ~1 分,复习间隔永远封顶在两周,
 * 负担 ∝ 词汇总量(实测 2000 词时 ~500 词/天,期末抽测记住率仅 30%)。
 * 梯子机制:连胜越高衰减越慢,间隔近似翻倍(约 7/14/28/56 天),
 * 3 连胜自动退休进抽查池。回测(2026-07,40 天真实日志):负担走平于
 * ~380 词/天且不再随总量增长,期末记住率 53%。
 *
 * 连胜规则(用户拍板):
 * - 只有「当天第一次见到这个词」的作答才可能 +1;
 * - 且答题前分数必须 ≥ 0——深坑词(-40 一路爬坡)答对不算连胜,先爬出坑;
 * - 模糊/忘记一律清零;非首见答对不加不清。
 */

export const SCORE_CAP = 20;
export const RETIRE_MIN_SCORE = 15;
export const AUTO_RETIRE_STREAK = 3;
/** 有 -20 前科的词要求更长的连胜才能退休 */
export const AUTO_RETIRE_STREAK_LOW_HISTORY = 5;
/** 每日从自动退休池临时复活的抽查数量 */
export const RETIRED_SPOT_CHECKS_PER_DAY = 3;

export interface LadderRow {
  importance: number;
  right_count: number;
  fuzzy_count: number;
  forgot_count: number;
  right_streak: number;
}

/**
 * 每日衰减速率:基础 2.0,按重要度与错误史微调后夹在 [1.6, 2.4],
 * 再按连胜逐级减半,最低 0.25/天。
 * 等效间隔(从 20 分衰减到 6 分):连胜 0 ≈ 7 天、1 ≈ 14 天、2 ≈ 28 天、3+ ≈ 56 天;
 * 刚失败的词当天回到 ~10 分,2 天后就查岗。
 */
export const ladderDecayRate = (row: LadderRow): number => {
  let base = 2.0 + ((row.importance || 3) - 3) * 0.2;
  const wrongish = row.forgot_count * 2 + row.fuzzy_count;
  const total = wrongish + row.right_count;
  if (total > 0) base += Math.min(wrongish / total, 1) * 0.4;
  if (row.right_count >= row.forgot_count + row.fuzzy_count + 3) base -= 0.2;
  base = Math.min(Math.max(base, 1.6), 2.4);
  return Math.max(base / 2 ** Math.max(row.right_streak, 0), 0.25);
};

/**
 * 衰减只作用于正分区间且止于 0:被上限顺延的到期词不再被扣成"危急",
 * 优先级不失真。负分维持旧的 -9 抬升语义(深坑词隔夜浮回 -9)。
 */
export const applyLadderDecay = (score: number, rate: number): number => (
  score > 0 ? Math.max(score - rate, 0) : Math.max(score, -9)
);

/** 答题后的新连胜值。preScore = 当日衰减后、本次作答前的分数。 */
export const nextRightStreak = (
  streak: number,
  answer: "know" | "fuzzy" | "forgot",
  firstOfDay: boolean,
  preScore: number
): number => {
  if (answer !== "know") return 0;
  if (firstOfDay && preScore >= 0) return streak + 1;
  return streak;
};

export const shouldAutoRetire = (streak: number, score: number, lowHistory: boolean): boolean => (
  streak >= (lowHistory ? AUTO_RETIRE_STREAK_LOW_HISTORY : AUTO_RETIRE_STREAK)
  && score >= RETIRE_MIN_SCORE
);
