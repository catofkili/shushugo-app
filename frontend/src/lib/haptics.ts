import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { WordAnswer } from "../types/vocabulary";

const ignoreHapticError = () => undefined;

export function triggerMemoryHaptic(answer: WordAnswer): void {
  if (answer === "forgot") {
    Haptics.vibrate({ duration: 64 }).catch(ignoreHapticError);
    return;
  }

  if (answer === "fuzzy") {
    Haptics.vibrate({ duration: 42 }).catch(ignoreHapticError);
    return;
  }

  if (answer === "know") {
    Haptics.impact({ style: ImpactStyle.Medium }).catch(ignoreHapticError);
    return;
  }

  Haptics.impact({ style: ImpactStyle.Heavy }).catch(ignoreHapticError);
}
