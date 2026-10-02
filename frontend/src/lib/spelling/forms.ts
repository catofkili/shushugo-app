import payload from "../../data/spelling_forms.json";
import {
  cleanWordSurface,
  isLoanwordSourceSurface,
  preferredWordSurface
} from "../orthography";
import type { AcceptedForm, SpellingTarget, WrittenFormTag } from "./types";

type AdditionalFormTag = Exclude<WrittenFormTag, "standard">;
type SpellingFormsEntry = {
  f?: Array<[surface: string, tag: AdditionalFormTag]>;
  r?: string[];
};
type SpellingFormsPayload = {
  version: string;
  entries: Record<string, SpellingFormsEntry>;
};

const spellingForms = payload as unknown as SpellingFormsPayload;
const hanPattern = /\p{Script=Han}/u;
const hiraganaPattern = /^[\u3041-\u3096\u309d-\u309f]+$/u;
const katakanaReadingPattern = /[\u30a1-\u30fa\u30fd\u30fe]/u;
const ignoredMarks = /[〜～~・\s]/gu;
const formTagOrder = new Map<WrittenFormTag, number>([
  ["standard", 0],
  ["variant", 1],
  ["rare", 2],
  ["ateji", 3]
]);
const byCodePoint = (left: string, right: string): number =>
  left.codePointAt(0)! - right.codePointAt(0)!;
const hasKanji = (surface: string): boolean => hanPattern.test(surface);
const cleanSpellingText = (text: string): string =>
  cleanWordSurface(text).replace(ignoredMarks, "").normalize("NFC");

function sourceTextForWord(kanji: string): string | undefined {
  for (const alias of kanji.split(/[；;]/u)) {
    const sourceText = alias
      .replace(/[（(][^（）()]*[）)]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/[A-Za-z]/u.test(sourceText)) return sourceText;
  }
  return undefined;
}

function isKatakanaReading(kana: string): boolean {
  return katakanaReadingPattern.test(kana) && /^[\u30a0-\u30ffー]+$/u.test(kana);
}

/**
 * 词库行 → 拼写判定要用的全部事实（规格 types.ts 的 SpellingTarget）。纯函数，不查数据库。
 */
export const spellingTargetForWord = (word: {
  id?: number;
  kanji: string;
  kana: string;
}): SpellingTarget => {
  const kana = cleanSpellingText(word.kana);
  const surface = preferredWordSurface(word);
  const isLoanword = isLoanwordSourceSurface(word);
  const primarySurface = cleanWordSurface(word.kanji);
  const key = cleanSpellingText(word.kanji) + "|" + kana;
  const extras = spellingForms.entries[key];
  const acceptedForms = new Map<string, WrittenFormTag>();
  const standardSurface = hasKanji(surface)
    ? surface
    : !isLoanword && hasKanji(primarySurface)
      ? primarySurface
      : "";

  const addForm = (candidate: string, tag: WrittenFormTag) => {
    if (!candidate || !hasKanji(candidate) || candidate === kana) return;
    const previous = acceptedForms.get(candidate);
    if (!previous || formTagOrder.get(tag)! < formTagOrder.get(previous)!) {
      acceptedForms.set(candidate, tag);
    }
  };

  if (standardSurface) addForm(standardSurface, "standard");
  if (standardSurface && primarySurface !== standardSurface) {
    addForm(primarySurface, "variant");
  }
  for (const [candidate, tag] of extras?.f ?? []) addForm(candidate, tag);

  const altReadings = isLoanword || isKatakanaReading(kana)
    ? []
    : [...new Set((extras?.r ?? []).filter((reading) =>
      reading !== kana && hiraganaPattern.test(reading)
    ))].sort(byCodePoint);
  const sourceText = isLoanword ? sourceTextForWord(word.kanji) : undefined;

  return {
    ...(word.id === undefined ? {} : { wordId: word.id }),
    kana,
    surface,
    forms: [...acceptedForms]
      .map(([formSurface, tag]) => ({ surface: formSurface, tag }))
      .sort((left, right) =>
        formTagOrder.get(left.tag)! - formTagOrder.get(right.tag)! ||
        byCodePoint(left.surface, right.surface)
      ) as AcceptedForm[],
    altReadings,
    isLoanword,
    ...(sourceText ? { sourceText } : {})
  };
};

export const SPELLING_FORMS_VERSION: string = spellingForms.version;
