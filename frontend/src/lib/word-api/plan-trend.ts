import { firstValue, today } from "../study-core";
import { dailyReviewCap } from "../review-budget";
import { getReviewCapPreference } from "../studyPreferences";

/**
 * 「今天比昨天少 N 个」—— 每天第一次打开首页时给一次的小反馈。
 *
 * 积压往下走的时候,首页上还是三位数,看不出在变好(实测 736 → 688 那天,
 * 感受是「又是七百」)。这里就负责把那个差值找出来说一次。
 *
 * 比的是**复习任务数**,不是首页大数字(复习 + 新词):
 *   - 新词是固定配额,改学习目标会让总数一起动,那不是积压在变化;
 *   - 未开始的新词任务还会被 reconcileStage1NewQuota 删掉,历史值不稳定,
 *     而复习任务一旦排进 stage1_tasks 就不再回收,拿它当昨天的账最准。
 *
 * 不落任何新快照:两天的数字都直接从 stage1_tasks 数,老库也能立刻用上。
 *
 * 只负责「有没有这件事」。播不播、播过没有、今天还剩多少预算,统一归 lib/moments。
 */

export interface PlanTrend {
  /** 今天的复习任务数 */
  today: number;
  /** 昨天的复习任务数 */
  yesterday: number;
  /** 少了几个(恒为正) */
  delta: number;
}

const previousDay = (day: string): string => {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() - 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
};

const reviewTaskCount = (day: string) => firstValue<number>(
  "SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'review'",
  [day],
  0
);

/**
 * 今天的计划比昨天少了几个;不满足报喜条件时返回 null。
 *
 * 调用前当天的计划必须已经排好(ensureStage1Tasks),否则今天恒为 0,
 * 会报出一个「少了一整天」的假喜讯 —— 首页是在读完 getWordStats 之后才 collectMoments 的。
 */
export const dailyPlanTrend = (day = today()): PlanTrend | null => {
  const yesterday = previousDay(day);
  if (!yesterday) return null;

  const yesterdayCount = reviewTaskCount(yesterday);
  // 昨天没排过计划(压根没打开过 app)就没有可比的账,宁可不说
  if (yesterdayCount <= 0) return null;

  const todayCount = reviewTaskCount(day);
  if (todayCount >= yesterdayCount) return null;

  // 计划被每日复习上限截断时,这个数字是「上限」不是「积压」——
  // 自动档上限 = 近期日均 × 1.5,前几天少背几个它自己就会往下掉,
  // 那时候说「比昨天少 20 个」是在拿懈怠当进步。只在没截断时才报。
  //
  // 只需判今天:今天没截断 → 今天的数字就是真实到期量;
  // 昨天若截断过,昨天显示的只会比真实积压更小,今天还更低,那就更是真的降了。
  if (todayCount >= dailyReviewCap(getReviewCapPreference(), day)) return null;

  return { today: todayCount, yesterday: yesterdayCount, delta: yesterdayCount - todayCount };
};
