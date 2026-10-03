/**
 * 提示阶梯（docs/SPELLING_SPEC.md §4）。只产出数据，文案在 messages.ts / UI。
 * 一级一级给：拍数和首拍 → 完整读音 → 揭晓书写（到这一级再答对也算 forgot，见 grade.ts）。
 */
import { splitMoras } from "./kana";
import { kanaToRomaji } from "./romaji";
import type { SpellingMode, SpellingTarget } from "./types";

export type SpellingHint =
  | { level: 0; meaning: string }
  | { level: 1; moraCount: number; first: string }
  | { level: 2; kana: string; romaji: string }
  | { level: 3; surface: string };

export const spellingHints = (
  target: SpellingTarget,
  mode: SpellingMode = "meaning",
  meaning = ""
): SpellingHint[] => {
  const moras = splitMoras(target.kana);
  const hints: SpellingHint[] = [
    { level: 1, moraCount: moras.length, first: moras[0] ?? "" },
    { level: 2, kana: target.kana, romaji: kanaToRomaji(target.kana) },
    { level: 3, surface: target.surface }
  ];
  return mode === "audio" ? [{ level: 0, meaning }, ...hints] : hints;
};
