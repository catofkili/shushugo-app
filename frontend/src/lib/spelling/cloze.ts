import { parseFurigana } from "../furigana-data";
import { cleanWordSurface } from "../orthography";
import { checkSpelling } from "./check";
import { spellingTargetForWord } from "./forms";
import type { SpellingCloze, SpellingTarget } from "./types";

export interface ClozeWord {
  id: number;
  kanji: string;
  kana: string;
  example_jp: string;
  example_meaning: string;
  example_furigana: string;
  example_tokens: string;
  example_lemmas: string;
}

export type ClozeFailureReason =
  | "no_example"
  | "no_translation"
  | "placeholder_word"
  | "no_unique_match"
  | "ambiguous_match"
  | "missing_furigana"
  | "invalid_reading"
  | "surface_not_accepted"
  | "reading_not_accepted";

type MatchKind = "lemma" | "surface" | "reading";
type ClozeResult = { cloze: SpellingCloze; target: SpellingTarget };

export interface ClozeAnalysis {
  result: ClozeResult | null;
  reason?: ClozeFailureReason;
  matchedBy?: MatchKind;
  observed?: { surface: string; reading: string; expectedSurface: string; expectedKana: string };
}

interface TokenSpan {
  start: number;
  end: number;
  text: string;
  clickable: boolean;
  lemma?: string;
}

interface LocatedSpan {
  start: number;
  end: number;
  matchedBy: MatchKind;
}

const ignoredMarks = /[〜～~・\s]/gu;
const kanjiPattern = /\p{Script=Han}/u;

const normalizeWord = (value: string): string =>
  cleanWordSurface(value).replace(ignoredMarks, "").normalize("NFC");

const dictionaryForms = (word: ClozeWord, target: SpellingTarget): Set<string> => {
  const forms = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeWord(value);
    if (normalized) forms.add(normalized);
  };
  add(target.surface);
  for (const form of target.forms) add(form.surface);
  for (const alias of word.kanji.split(/[;；]/u)) add(alias);
  return forms;
};

const readingForms = (word: ClozeWord, target: SpellingTarget): Set<string> => {
  const readings = new Set<string>();
  for (const value of [word.kana, target.kana]) {
    const normalized = normalizeWord(value);
    if (normalized) readings.add(normalized);
  }
  return readings;
};

const readLemmaMap = (raw: string): Record<string, string> => {
  if (!raw) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return {}; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const lemmas: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    if (!/^\d+$/u.test(key)) continue;
    const item = (value as Record<string, unknown>)[key];
    const lemma = typeof item === "string"
      ? item
      : item && typeof item === "object" && !Array.isArray(item)
        ? (item as { lemma?: unknown }).lemma
        : "";
    if (typeof lemma === "string" && lemma.trim()) lemmas[key] = lemma.trim();
  }
  return lemmas;
};

/** Token 长度用 UTF-16；负数是不能点开的助词等功能词，但仍占据句中边界。 */
const readTokenSpans = (raw: string, text: string, rawLemmas: string): TokenSpan[] | null => {
  if (!raw.trim()) return null;
  const lengths = raw.split(",").map(Number);
  if (!lengths.length || lengths.some((length) => !Number.isInteger(length) || length === 0)) return null;
  const total = lengths.reduce((sum, length) => sum + Math.abs(length), 0);
  if (total !== text.length) return null;

  const lemmas = readLemmaMap(rawLemmas);
  const spans: TokenSpan[] = [];
  let start = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = Math.abs(lengths[index]);
    const end = start + length;
    const lemma = lemmas[String(index)];
    spans.push({
      start,
      end,
      text: text.slice(start, end),
      clickable: lengths[index] > 0,
      ...(lemma ? { lemma } : {})
    });
    start = end;
  }
  return spans;
};

const occurrences = (text: string, needle: string): number[] => {
  if (!needle) return [];
  const found: number[] = [];
  let cursor = 0;
  while (cursor <= text.length - needle.length) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) break;
    found.push(index);
    cursor = index + 1;
  }
  return found;
};

const fromUniqueCandidates = (
  sentence: string,
  candidates: Set<string>,
  matchedBy: "surface" | "reading",
  blocked: TokenSpan[]
): { span: LocatedSpan | null; ambiguous: boolean } => {
  const matches = new Map<string, LocatedSpan>();
  for (const candidate of candidates) {
    for (const start of occurrences(sentence, candidate)) {
      const end = start + candidate.length;
      if (blocked.some((token) => start >= token.start && end <= token.end)) continue;
      matches.set(`${start}:${end}`, { start, end, matchedBy });
    }
  }
  const found = [...matches.values()];
  return { span: found.length === 1 ? found[0] : null, ambiguous: found.length > 1 };
};

const readingForSpan = (sentence: string, start: number, end: number, rawFurigana: string): string | null => {
  const annotations = parseFurigana(rawFurigana)?.slice().sort((left, right) => left.start - right.start) ?? [];
  const hasKanji = kanjiPattern.test(sentence.slice(start, end));
  let reading = "";
  let cursor = start;

  for (const annotation of annotations) {
    const annotationEnd = annotation.start + annotation.length;
    if (annotationEnd <= start || annotation.start >= end) continue;
    if (annotation.start < start || annotationEnd > end || annotation.start < cursor) return null;

    const plain = sentence.slice(cursor, annotation.start);
    if (kanjiPattern.test(plain)) return null;
    reading += plain;

    const annotatedSurface = sentence.slice(annotation.start, annotationEnd);
    if (!kanjiPattern.test(annotatedSurface)) return null;
    reading += annotation.reading;
    cursor = annotationEnd;
  }

  const tail = sentence.slice(cursor, end);
  if (kanjiPattern.test(tail)) return null;
  reading += tail;
  return hasKanji && !annotations.some((annotation) =>
    annotation.start >= start && annotation.start + annotation.length <= end
  ) ? null : reading;
};

const isPlaceholderWord = (word: ClozeWord): boolean => /[〜～~]/u.test(`${word.kanji}${word.kana}`);

export const analyzeCloze = (word: ClozeWord): ClozeAnalysis => {
  const sentence = word.example_jp;
  if (!sentence.trim()) return { result: null, reason: "no_example" };
  const translation = word.example_meaning.trim();
  if (!translation) return { result: null, reason: "no_translation" };
  if (isPlaceholderWord(word)) return { result: null, reason: "placeholder_word" };

  const dictionaryTarget = spellingTargetForWord({ id: word.id, kanji: word.kanji, kana: word.kana });
  const surfaces = dictionaryForms(word, dictionaryTarget);
  const readings = readingForms(word, dictionaryTarget);
  let located: LocatedSpan | null = null;

  const tokens = readTokenSpans(word.example_tokens, sentence, word.example_lemmas);
  const blocked = tokens?.filter((token) => !token.clickable) ?? [];
  if (tokens) {
    const tokenMatches = tokens.filter((token) => token.clickable && token.lemma && (
      surfaces.has(normalizeWord(token.lemma)) || readings.has(normalizeWord(token.lemma))
    ));
    if (tokenMatches.length > 1) return { result: null, reason: "ambiguous_match" };
    if (tokenMatches.length === 1) {
      const token = tokenMatches[0];
      located = { start: token.start, end: token.end, matchedBy: "lemma" };
    }
  }

  if (!located) {
    const bySurface = fromUniqueCandidates(sentence, surfaces, "surface", blocked);
    if (bySurface.ambiguous) return { result: null, reason: "ambiguous_match" };
    located = bySurface.span;
  }

  if (!located) {
    const byReading = fromUniqueCandidates(sentence, readings, "reading", blocked);
    if (byReading.ambiguous) return { result: null, reason: "ambiguous_match" };
    located = byReading.span;
  }
  if (!located) return { result: null, reason: "no_unique_match" };

  const surface = sentence.slice(located.start, located.end);
  const reading = readingForSpan(sentence, located.start, located.end, word.example_furigana);
  if (reading === null) return { result: null, reason: "missing_furigana" };
  if (!reading) return { result: null, reason: "invalid_reading" };

  const target = dictionaryForms(word, dictionaryTarget).has(normalizeWord(surface))
    ? dictionaryTarget
    : {
      wordId: word.id,
      kana: reading,
      surface,
      forms: [{ surface, tag: "standard" as const }],
      altReadings: [],
      isLoanword: false
    };
  const observed = { surface, reading, expectedSurface: target.surface, expectedKana: target.kana };
  if (!checkSpelling(target, surface).correct) return { result: null, reason: "surface_not_accepted", observed };
  if (!checkSpelling(target, reading).correct) return { result: null, reason: "reading_not_accepted", observed };

  return {
    result: {
      cloze: {
        before: sentence.slice(0, located.start),
        after: sentence.slice(located.end),
        translation,
        surface,
        reading
      },
      target
    },
    matchedBy: located.matchedBy
  };
};

export const clozeFor = (word: ClozeWord): ClozeResult | null => analyzeCloze(word).result;
