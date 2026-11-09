import type { PlanKind } from "../plan-level-order";

const HORIZON_DAYS = 28; // 看完整个新学复习最密的前四周。
const BUDGET_GROWTH = 1.2; // 完成证据足够且预算确实限制安排时，从昨日B试探。
const OVERLOAD_SLACK = 1; // 今日已预留重学时间，不再额外放大；欠账仍留在到期池。
export const DEFAULT_MAX_SCALE = 1.5; // 时间充裕也不超过备考需要量的一倍半。
const SMOOTH = 0.3; // 每日常规变化限制在昨日的三成。
const MIN_CHANGE = 10; // 过载归零后须尽快恢复；两张起步会吃掉短备考窗口，额度仍须通过峰值检查。
const FALLBACK_MINUTES = 20; // 无历史也无计划时先给温和的二十分钟。
// load-model.ts 的私有曲线；不为离线实验新增生产 export。次数包括首次学习。
const ANSWERS_BY_AGE_WEEK = [3, 2, 1.5, 1.5, 0.5, 0.5, 0.5, 0.5];
const KINDS: PlanKind[] = ["words", "grammar", "kanji", "confusion"];
const byKind = <T>(make: (kind: PlanKind) => T): Record<PlanKind, T> =>
  Object.fromEntries(KINDS.map(k => [k, make(k)])) as Record<PlanKind, T>;

export interface BudgetInput {
  budgetMinutes: number;
  seconds: Record<PlanKind, number>;
  mandatoryToday: Record<PlanKind, number>;
  dueForecast: Record<PlanKind, number[]>; // 下标 0 为明天，已有卡只计首次到期。
  priorForecast: Record<PlanKind, number[]>;
  need: Record<PlanKind, number>;
  contentLeft: Record<PlanKind, number>;
  locked: Partial<Record<PlanKind, { fresh?: number; review?: number }>>;
  previousFresh?: Record<PlanKind, number>;
  horizonDays?: number;
  uncappedToday?: Record<PlanKind, number>; // 先验、减负、压轴不占普通复习 cap。
  maxScale?: number; // 只给冷启动估「按计划量要几分钟」用（传 1）；排片照默认 MAX_SCALE。
  maxFresh?: Record<PlanKind, number>; // 与偏好入口允许保存的上限对齐，预测生效量。
  todayBudgetMinutes?: number; // 晨间每卡一次的清单，另给当天重学留时间。
}
export interface BudgetOutput {
  fresh: Record<PlanKind, number>;
  reviewLimit: Record<PlanKind, number | null>; // 锁定值照返；调用方不得写锁定字段。
  peakMinutes: number;
  scale: number;
  overloaded: boolean;
}

export interface BudgetHistoryDay { minutes: number; completed: boolean }
export const inferBudgetMinutes = (input: {
  history: BudgetHistoryDay[]; // 从旧到新，仅观测到的完成情况才标 completed。
  budgetMinutes?: number;
  fallbackMinutes?: number;
  previous?: { B: number; binding: boolean }; // 昨天推断的 B，以及当时 B 是否卡住了新学（scale < DEFAULT_MAX_SCALE）。
}): number => {
  if (input.budgetMinutes !== undefined) return input.budgetMinutes;
  const active = input.history.filter(d => d.minutes > 0).slice(-14);
  if (!active.length) return input.fallbackMinutes && input.fallbackMinutes > 0 ? input.fallbackMinutes : FALLBACK_MINUTES;
  const sorted = active.map(d => d.minutes).sort((a, b) => a - b);
  const median = (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
  const recent = active.slice(-7);
  if (!recent[recent.length - 1].completed) return median;
  // 第二轮（2026-11-09）：做完的日子从昨天的 B 往上试探，不从「实做中位数」往上。
  // 实做 ≤ 清单 < B（28 天峰值约束让当天清单只有 B 的六七成），从实做 ×1.1 起算是棘轮：
  // 第一轮冲刺可用 75 分钟、天天做完，B 仍卡在 14 分钟。没做完的日子才是「时间不够」的直接观测，那时回落到实做中位数。
  const previous = Math.max(median, input.previous?.B ?? median);
  return recent.filter(d => d.completed).length < 4 || input.previous && !input.previous.binding
    ? previous : previous * BUDGET_GROWTH;
};

export const allocateDay = (input: BudgetInput): BudgetOutput => {
  const { seconds, mandatoryToday, locked, contentLeft, need, previousFresh } = input;
  const budget = Math.max(0, input.budgetMinutes);
  const todayBudget = Math.min(budget, input.todayBudgetMinutes ?? budget);
  const horizon = Math.max(1, Math.floor(input.horizonDays ?? HORIZON_DAYS));
  const MAX_SCALE = input.maxScale ?? DEFAULT_MAX_SCALE;
  const mandatory = KINDS.reduce((sum, k) => sum + mandatoryToday[k] * seconds[k] / 60, 0);
  const reviewLimit = byKind(k => locked[k]?.review ?? null);
  const freshAt = (scale: number, smooth: boolean, minimum: boolean) => byKind(k => {
    if (locked[k]?.fresh !== undefined) return locked[k]!.fresh!;
    if (need[k] <= 0 || contentLeft[k] <= 0) return 0;
    const maximum = Math.min(contentLeft[k], need[k] * MAX_SCALE, input.maxFresh?.[k] ?? Infinity);
    let count = Math.floor(Math.min(maximum, need[k] * scale));
    if (minimum) count = Math.max(1, count);
    if (previousFresh) {
      const change = Math.max(MIN_CHANGE, previousFresh[k] * SMOOTH);
      count = Math.min(Math.floor(previousFresh[k] + change), smooth ? Math.max(Math.ceil(previousFresh[k] - change), count) : count);
    }
    return Math.max(0, Math.min(Math.floor(maximum), count));
  });
  const minutesAt = (fresh: Record<PlanKind, number>, day: number, todayCounts: Record<PlanKind, number>) => KINDS.reduce((sum, k) => {
    let answers = day === 0 ? todayCounts[k] : (input.dueForecast[k][day - 1] ?? 0) + (input.priorForecast[k][day - 1] ?? 0);
    for (let cohort = 0; cohort <= day; cohort++) {
      const count = Math.max(0, Math.min(fresh[k], contentLeft[k] - cohort * fresh[k]));
      const age = day - cohort;
      // 首次当天答一次，首周余下两次摊到后六天；周总次数仍是 3、2、1.5、1.5…。
      const weight = age === 0 ? 1 : age < 7 ? (ANSWERS_BY_AGE_WEEK[0] - 1) / 6
        : (ANSWERS_BY_AGE_WEEK[Math.floor(age / 7)] ?? 0.5) / 7;
      answers += count * weight;
    }
    return sum + answers * seconds[k] / 60;
  }, 0);
  const peak = (fresh: Record<PlanKind, number>, todayCounts = mandatoryToday) => Math.max(...Array.from({ length: horizon + 1 }, (_, day) => minutesAt(fresh, day, todayCounts)));
  if (mandatory >= todayBudget) {
    const fixed = KINDS.reduce((sum, k) => sum + (locked[k]?.review !== undefined ? mandatoryToday[k] : input.uncappedToday?.[k] ?? 0) * seconds[k] / 60, 0);
    const variable = Math.max(0, mandatory - fixed);
    const fraction = variable ? Math.min(1, Math.max(0, todayBudget * OVERLOAD_SLACK - fixed) / variable) : 0;
    for (const k of KINDS) if (locked[k]?.review === undefined) {
      reviewLimit[k] = Math.floor(Math.max(0, mandatoryToday[k] - (input.uncappedToday?.[k] ?? 0)) * fraction);
    }
    const fresh = byKind(k => locked[k]?.fresh ?? 0);
    const reduced = byKind(k => locked[k]?.review !== undefined ? mandatoryToday[k] : reviewLimit[k]! + (input.uncappedToday?.[k] ?? 0));
    return { fresh, reviewLimit, scale: 0, overloaded: true, peakMinutes: peak(fresh, reduced) };
  }
  const findScale = (smooth: boolean, minimum: boolean): number | null => {
    const feasible = (scale: number) => {
      const fresh = freshAt(scale, smooth, minimum);
      return peak(fresh) <= budget && minutesAt(fresh, 0, mandatoryToday) <= todayBudget;
    };
    // 最大值本身可行才返回 1.5，避免二分尾差造成少分一张。
    if (feasible(MAX_SCALE)) return MAX_SCALE;
    let low = 0, high = MAX_SCALE;
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2;
      if (feasible(mid)) low = mid; else high = mid;
    }
    // 内容耗尽会让未来负荷不再单调；枚举最终平滑额度变化的区间，不能逐类取小值冒充安全解。
    if (KINDS.some(k => locked[k]?.fresh === undefined && contentLeft[k] < need[k] * MAX_SCALE * (horizon + 1))) {
      const edges = new Set([MAX_SCALE]);
      for (const k of KINDS) if (locked[k]?.fresh === undefined && need[k] > 0) {
        const maximum = Math.floor(Math.min(contentLeft[k], need[k] * MAX_SCALE, budget * 60 / seconds[k]));
        for (let n = 1; n <= maximum + 1; n++) if (n / need[k] < MAX_SCALE) edges.add(n / need[k]);
      }
      for (const edge of [...edges].sort((a, b) => b - a)) {
        const candidate = edge * (1 - 4 * Number.EPSILON);
        if (candidate <= low) break;
        if (feasible(candidate)) return candidate;
      }
    }
    return feasible(low) ? low : null;
  };
  const modes = [[true, true], [false, true], [true, false], [false, false]];
  let scale = 0, smooth = false, minimum = false;
  for (const [withSmoothing, withMinimum] of modes) {
    const candidate = findScale(withSmoothing, withMinimum);
    if (candidate === null) continue;
    // 保存求解时的平滑模式；放开下降下限后不能在输出时又加回来，重新撞破预算。
    scale = candidate; smooth = withSmoothing; minimum = withMinimum;
    break;
  }
  const fresh = freshAt(scale, smooth, minimum);
  const peakMinutes = peak(fresh);
  return { fresh, reviewLimit, peakMinutes, scale, overloaded: peakMinutes > budget || minutesAt(fresh, 0, mandatoryToday) > todayBudget };
};
