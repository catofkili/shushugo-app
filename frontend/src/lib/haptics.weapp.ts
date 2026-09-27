import type { WordAnswer } from "../types/vocabulary";

const vibrate = (type: "short" | "long") => {
  try {
    const api = (globalThis as any).wx;
    const method = type === "long" ? api?.vibrateLong : api?.vibrateShort;
    if (typeof method === "function") method.call(api, { type: type === "long" ? "heavy" : "light" });
  } catch { /* 设备不支持震动时不影响学习 */ }
};

export function triggerMemoryHaptic(_answer: WordAnswer): void {
  vibrate("short");
}

export const triggerCountdownHaptic = () => vibrate("short");
export const triggerReliefHaptic = () => vibrate("long");
export const triggerRevealHaptic = () => vibrate("short");
export const triggerSwipeArmHaptic = () => vibrate("short");
export const triggerAchievementHaptic = () => vibrate("long");
