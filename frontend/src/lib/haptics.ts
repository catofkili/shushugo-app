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
