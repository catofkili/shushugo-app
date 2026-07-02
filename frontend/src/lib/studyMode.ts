import type { StudyMode } from "../types/app";

const KEY = "mn-active-study-mode";
const modes = new Set<StudyMode>(["classic", "vocabulary", "reverse", "kanji"]);

export const defaultStudyMode: StudyMode = "classic";

export function getStudyMode(): StudyMode {
  const value = localStorage.getItem(KEY) as StudyMode | null;
  return value && modes.has(value) ? value : defaultStudyMode;
}

export function saveStudyMode(mode: StudyMode): StudyMode {
  const safeMode = modes.has(mode) ? mode : defaultStudyMode;
  localStorage.setItem(KEY, safeMode);
  return safeMode;
}
