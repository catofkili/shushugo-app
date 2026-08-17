import type { JLPTLevel } from "../types/grammar";

export type GrammarLevelSelection = "All" | JLPTLevel;

export const GRAMMAR_LEVEL_PREFERENCE_KEY = "jp-grammar-selected-level-v1";

const LEVELS: readonly GrammarLevelSelection[] = ["All", "N5", "N4", "N3", "N2", "N1"];

export const normalizeGrammarLevel = (value: unknown): GrammarLevelSelection => (
  LEVELS.includes(value as GrammarLevelSelection) ? value as GrammarLevelSelection : "N5"
);

export const getGrammarLevelPreference = (): GrammarLevelSelection => {
  try {
    return normalizeGrammarLevel(localStorage.getItem(GRAMMAR_LEVEL_PREFERENCE_KEY));
  } catch {
    return "N5";
  }
};

export const saveGrammarLevelPreference = (value: unknown): GrammarLevelSelection => {
  const level = normalizeGrammarLevel(value);
  try {
    localStorage.setItem(GRAMMAR_LEVEL_PREFERENCE_KEY, level);
  } catch {
    // 隐私模式/存储被禁用时仍保留本次会话的 React 状态。
  }
  return level;
};
