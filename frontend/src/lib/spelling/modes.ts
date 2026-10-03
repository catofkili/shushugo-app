import { rowsFor } from "../database/db-utils";
import { clozeFor } from "./cloze";
import type { SpellingMode } from "./types";

const clozeCache = new Map<number, ReturnType<typeof clozeFor>>();
const modeCache = new Map<number, SpellingMode[]>();

export const spellingClozeForWordId = (wordId: number): ReturnType<typeof clozeFor> => {
  if (clozeCache.has(wordId)) return clozeCache.get(wordId) ?? null;
  const row = rowsFor(`
    SELECT id, kanji, kana, example_jp, example_meaning, example_furigana,
      example_tokens, example_lemmas
    FROM words WHERE id = ?
  `, [wordId])[0];
  const result = row ? clozeFor({
    id: Number(row.id),
    kanji: String(row.kanji ?? ""),
    kana: String(row.kana ?? ""),
    example_jp: String(row.example_jp ?? ""),
    example_meaning: String(row.example_meaning ?? ""),
    example_furigana: String(row.example_furigana ?? ""),
    example_tokens: String(row.example_tokens ?? ""),
    example_lemmas: String(row.example_lemmas ?? "")
  }) : null;
  clozeCache.set(wordId, result);
  return result;
};

export const availableSpellingModes = (wordId: number): SpellingMode[] => {
  const cached = modeCache.get(wordId);
  if (cached) return cached.slice();
  const modes: SpellingMode[] = ["meaning", "audio"];
  if (spellingClozeForWordId(wordId)) modes.push("cloze");
  modeCache.set(wordId, modes);
  return modes.slice();
};

export const chooseSpellingMode = (
  wordId: number,
  prefs: { modes: SpellingMode[]; modeStrategy: "random" | "rotate" },
  available?: SpellingMode[],
  rng: () => number = Math.random
): SpellingMode => {
  const enabled = [...new Set(prefs.modes)];
  if (!enabled.length) return "meaning";
  const index = prefs.modeStrategy === "rotate"
    ? ((wordId % enabled.length) + enabled.length) % enabled.length
    : Math.min(Math.max(Math.floor(rng() * enabled.length), 0), enabled.length - 1);
  const chosen = enabled[index];
  return (available ?? availableSpellingModes(wordId)).includes(chosen) ? chosen : "meaning";
};
