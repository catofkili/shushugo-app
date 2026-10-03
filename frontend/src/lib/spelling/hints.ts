/**
 * 提示阶梯（docs/SPELLING_SPEC.md §4）。只产出数据，文案在 messages.ts / UI。
 * 一级一级给：拍数和首拍 → 完整读音 → 揭晓书写（到这一级再答对也算 forgot，见 grade.ts）。
 * 听写（audio）的题面没有释义，所以第 1 级顺带把意思给出来（`meaning` 字段）——阶梯仍是三级，
 * 不然按钮次数和 `REVEAL_HINT_LEVEL`（揭晓级 = 3）都得跟着改。
 */
import { splitMoras } from "./kana";
import { kanaToRomaji } from "./romaji";
import type { SpellingMode, SpellingTarget } from "./types";

export type SpellingHint =
  | { level: 1; moraCount: number; first: string; meaning?: string }
  | { level: 2; kana: string; romaji: string }
  | { level: 3; surface: string };

export const spellingHints = (
  target: SpellingTarget,
  mode: SpellingMode = "meaning",
  meaning = ""
): SpellingHint[] => {
  const moras = splitMoras(target.kana);
  const hints: SpellingHint[] = [
    { level: 1, moraCount: moras.length, first: moras[0] ?? "", ...(mode === "audio" && meaning ? { meaning } : {}) },
    { level: 2, kana: target.kana, romaji: kanaToRomaji(target.kana) },
    { level: 3, surface: target.surface }
  ];
  return hints;
};
