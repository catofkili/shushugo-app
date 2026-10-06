/**
 * 提示阶梯（docs/SPELLING_SPEC.md §4）。只产出数据，文案在 UI。
 * 一级一级给：拍数和首拍 → 完整读音 → 揭晓书写。提示不影响评分（档位由用户自己选），只记进流水。
 * 听写（audio）的题面没有释义，所以第 1 级顺带把意思给出来（`meaning` 字段）——阶梯仍是三级，
 * 不然按钮上的次数（3）也得跟着改。
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
