import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { WordAnswer } from "../types/vocabulary";

const ignoreHapticError = () => undefined;

export function triggerMemoryHaptic(answer: WordAnswer): void {
  if (answer === "forgot") {
    Haptics.vibrate({ duration: 84 }).catch(ignoreHapticError);
    return;
  }

  if (answer === "fuzzy") {
    Haptics.vibrate({ duration: 56 }).catch(ignoreHapticError);
    return;
  }

  if (answer === "know") {
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(ignoreHapticError);
    return;
  }

  Haptics.impact({ style: ImpactStyle.Heavy }).catch(ignoreHapticError);
}

/** 最后三十张的每步倒数反馈：短而清楚，不把学习页变成持续震动。 */
export function triggerCountdownHaptic(): void {
  Haptics.vibrate({ duration: 92 }).catch(ignoreHapticError);
}

/** 昨日减负的自动发牌反馈，比普通「认识」更有落点。 */
export function triggerReliefHaptic(): void {
  Haptics.impact({ style: ImpactStyle.Heavy }).catch(ignoreHapticError);
}

/**
 * 翻面。整个循环里最高频的一下(每张卡都要做一次),在此之前它只有声音没有触觉。
 * 必须是 Light —— 翻面不是结算,给重了会和评分的 Heavy 抢层次。
 */
export function triggerRevealHaptic(): void {
  Haptics.impact({ style: ImpactStyle.Light }).catch(ignoreHapticError);
}

/**
 * 甩卡越过/退回提交阈值的那一帧。
 * 在此之前「甩够了没」只有印章的透明度在说,必须盯着屏幕看才知道；
 * 阈值类手势在 iOS 上一律给触觉,这样不看屏幕也知道松手会发生什么。
 */
export function triggerSwipeArmHaptic(): void {
  Haptics.impact({ style: ImpactStyle.Light }).catch(ignoreHapticError);
}

/** 成就解锁。比评分重一档:一天里最多响几次,是真正该有仪式感的那一下。 */
export function triggerAchievementHaptic(): void {
  Haptics.impact({ style: ImpactStyle.Medium }).catch(ignoreHapticError);
}
