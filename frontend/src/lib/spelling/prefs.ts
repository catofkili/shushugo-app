import type { SpellingMode } from "./types";

export interface SpellingPrefs {
  modes: SpellingMode[];
  modeStrategy: "random" | "rotate";
  dailyCap: number;
  minStabilityDays: number;
  inlineAfterGraduation: boolean;
  inlineDailyCap: number;
  showMeaningInAudio: boolean;
  clozeShowTranslation: boolean;
}

export const DEFAULT_SPELLING_PREFS: Readonly<SpellingPrefs> = {
  modes: ["meaning"], modeStrategy: "random", dailyCap: 30, minStabilityDays: 0,
  inlineAfterGraduation: false, inlineDailyCap: 5,
  showMeaningInAudio: false, clozeShowTranslation: true
};
export const SPELLING_PREFS_EVENT = "shushugo-spelling-prefs-changed";
const KEY = "shushugo-spelling-prefs";
const MODES: SpellingMode[] = ["meaning", "audio", "cloze"];

const normalize = (raw: unknown): SpellingPrefs => {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const modes = Array.isArray(value.modes)
    ? MODES.filter((mode) => (value.modes as unknown[]).includes(mode)) : [];
  const choice = (field: "dailyCap" | "minStabilityDays" | "inlineDailyCap", allowed: number[]) =>
    typeof value[field] === "number" && allowed.includes(value[field] as number)
      ? value[field] as number : DEFAULT_SPELLING_PREFS[field];
  const bool = (field: "inlineAfterGraduation" | "showMeaningInAudio" | "clozeShowTranslation") =>
    typeof value[field] === "boolean" ? value[field] as boolean : DEFAULT_SPELLING_PREFS[field];
  return {
    modes: modes.length ? modes : [...DEFAULT_SPELLING_PREFS.modes],
    modeStrategy: value.modeStrategy === "rotate" ? "rotate" : "random",
    dailyCap: choice("dailyCap", [0, 10, 20, 30, 50]),
    minStabilityDays: choice("minStabilityDays", [0, 7, 21, 60]),
    inlineDailyCap: choice("inlineDailyCap", [3, 5, 10]),
    inlineAfterGraduation: bool("inlineAfterGraduation"),
    showMeaningInAudio: bool("showMeaningInAudio"),
    clozeShowTranslation: bool("clozeShowTranslation")
  };
};

export const getSpellingPrefs = (): SpellingPrefs => {
  try { return normalize(JSON.parse(localStorage.getItem(KEY) ?? "null")); }
  catch { return normalize(null); }
};

export const saveSpellingPrefs = (patch: Partial<SpellingPrefs>): SpellingPrefs => {
  const prefs = normalize({ ...getSpellingPrefs(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 存储受限时仍可在当前页面调整。 */ }
  // 和 studyPreferences 共用 Taro 的 window / CustomEvent 适配。
  try { window.dispatchEvent(new CustomEvent(SPELLING_PREFS_EVENT, { detail: prefs })); } catch { /* 无事件平台取默认。 */ }
  return prefs;
};
