import { today } from "../study-core";
import type { SpellingPrefs } from "./prefs";

interface InlineDeps {
  lastEncounterToday: (wordId: number) => boolean;
  spellingInlineToday: () => number;
  spellingDoneToday: () => number;
  askedToday: (wordId: number) => boolean;
  seed: (wordId: number, options: { minStabilityDays: number }) => boolean;
}

export const inlineSpellingDecision = (wordId: number, prefs: SpellingPrefs, deps: InlineDeps): { show: boolean; reason: string } => {
  if (!prefs.inlineAfterGraduation) return { show: false, reason: "disabled" };
  if (!deps.lastEncounterToday(wordId)) return { show: false, reason: "not-graduated" };
  if (deps.askedToday(wordId)) return { show: false, reason: "asked-today" };
  if (deps.spellingInlineToday() >= prefs.inlineDailyCap) return { show: false, reason: "inline-cap" };
  if (prefs.dailyCap > 0 && deps.spellingDoneToday() >= prefs.dailyCap) return { show: false, reason: "daily-cap" };
  if (!deps.seed(wordId, { minStabilityDays: prefs.minStabilityDays })) return { show: false, reason: "ineligible" };
  return { show: true, reason: "eligible" };
};

const PREFIX = "shushugo-spelling-asked-";
const askedIds = (): number[] => {
  try {
    const key = `${PREFIX}${today()}`;
    // 收集键之后再删除，避免 localStorage 的下标因删除而移动。
    const stale: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const storedKey = localStorage.key(index);
      if (storedKey?.startsWith(PREFIX) && storedKey !== key) stale.push(storedKey);
    }
    stale.forEach((storedKey) => localStorage.removeItem(storedKey));
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [];
  } catch { return []; }
};

export const askedToday = (wordId: number): boolean => askedIds().includes(wordId);
export const markAskedToday = (wordId: number): void => {
  const ids = askedIds();
  if (!Number.isSafeInteger(wordId) || wordId <= 0 || ids.includes(wordId)) return;
  try { localStorage.setItem(`${PREFIX}${today()}`, JSON.stringify([...ids, wordId])); } catch { /* 本地存储受限不阻塞背词。 */ }
};
