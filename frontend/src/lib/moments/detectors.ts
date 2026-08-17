import { dailyPlanTrend } from "../word-api/plan-trend";
import { MOMENT_PRIORITY, type Moment } from "./types";

/**
 * 检测器:纯查询,只回答「此刻有没有这件事发生」。
 *
 * 不负责去重、不负责记账、不负责决定播不播 —— 那三件事在 bus 里统一做。
 * 检测器**绝不能写调度**:时刻是只读的旁观者,判定归 FSRS,庆祝归庆祝。
 */
export type MomentDetector = (day: string) => Moment | null;

/** 「今天比昨天少 N 个」:积压往下走的时候,首页上还是三位数,看不出在变好 */
const planTrend: MomentDetector = (day) => {
  const trend = dailyPlanTrend(day);
  if (!trend) return null;
  return {
    kind: "plan_trend",
    key: day,                      // 每天一次
    priority: MOMENT_PRIORITY.planTrend,
    text: `比昨天少 ${trend.delta} 个！`,
    holdMs: 3200
  };
};

export const MOMENT_DETECTORS: MomentDetector[] = [planTrend];
