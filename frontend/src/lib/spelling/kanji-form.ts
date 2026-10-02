import payload from "../../data/spelling_kanji_forms.json";

export type KanjiFormKind = "japanese" | "simplified" | "traditional" | "unknown";

export interface KanjiFormInfo {
  kind: KanjiFormKind;
  /** kind 为 simplified / traditional 时：应写的日文字形 */
  japanese?: string;
}

const data = payload as {
  japaneseCharacters: string;
  simplifiedToJapanese: Record<string, string>;
  traditionalToJapanese: Record<string, string>;
};
const japaneseCharacters = new Set([...data.japaneseCharacters]);
const hanPattern = /\p{Script=Han}/u;

export const kanjiFormOf = (char: string): KanjiFormInfo => {
  if ([...char].length !== 1 || !hanPattern.test(char)) return { kind: "unknown" };
  if (japaneseCharacters.has(char)) return { kind: "japanese" };

  const simplified = data.simplifiedToJapanese[char];
  if (simplified) return { kind: "simplified", japanese: simplified };

  const traditional = data.traditionalToJapanese[char];
  if (traditional) return { kind: "traditional", japanese: traditional };

  return { kind: "unknown" };
};

export const toJapaneseForms = (text: string): {
  text: string;
  changes: Array<{
    index: number;
    typed: string;
    expected: string;
    kind: "simplified" | "traditional";
  }>;
} => {
  const changes: Array<{
    index: number;
    typed: string;
    expected: string;
    kind: "simplified" | "traditional";
  }> = [];
  let result = "";
  let index = 0;

  for (const char of text) {
    const info = kanjiFormOf(char);
    if ((info.kind === "simplified" || info.kind === "traditional") && info.japanese) {
      changes.push({ index, typed: char, expected: info.japanese, kind: info.kind });
      result += info.japanese;
    } else {
      result += char;
    }
    index += char.length;
  }

  return { text: result, changes };
};
