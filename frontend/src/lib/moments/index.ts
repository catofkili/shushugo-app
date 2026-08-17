import { today } from "../study-core";
import { MOMENT_DETECTORS } from "./detectors";
import { markMomentFired, migrateLegacyMoments, momentFired, momentsFiredOn } from "./store";
import { MOMENT_DAILY_BUDGET, type Moment } from "./types";

export type { Moment, MomentKind } from "./types";
export { MOMENT_DAILY_BUDGET, MOMENT_PRIORITY } from "./types";
export { momentFired, momentsFiredOn } from "./store";

/**
 * 时刻总线:跑一遍所有检测器,吐出这一刻该播的。
 *
 * 调用方可以随便调 —— 记账在库里,已经播过的不会再出来。
 * 前提是当天的计划已经排好(ensureStage1Tasks),所以首页是在读完 stats 之后才调的:
 * 计划还没排时 plan_trend 会看到「今天 0 个」,报出一个「少了一整天」的假喜讯。
 */
export const collectMoments = (day = today()): Moment[] => {
  migrateLegacyMoments();

  const budget = MOMENT_DAILY_BUDGET - momentsFiredOn(day);
  if (budget <= 0) return [];

  const found = MOMENT_DETECTORS
    .map((detect) => {
      try {
        return detect(day);
      } catch {
        // 一个检测器塌了(老库缺表之类)不该带走其他人的庆祝
        return null;
      }
    })
    .filter((moment): moment is Moment => moment !== null && !momentFired(moment.kind, moment.key))
    .sort((a, b) => b.priority - a.priority)
    // 超预算的直接丢,不留到明天:时刻的价值在于「此刻正好发生」
    .slice(0, budget);

  // 当场记账。检测和播报之间隔着一次 React 渲染,不马上落库的话,
  // 进度事件触发的下一次 collect 会把同一个时刻再检测出来一遍。
  found.forEach((moment) => markMomentFired(moment.kind, moment.key, day));
  return found;
};
