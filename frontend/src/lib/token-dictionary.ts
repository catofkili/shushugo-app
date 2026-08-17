import { rowsFor } from "./study-core";
import {
  isKnownVerbPair,
  isPotentialReadingCompatible,
  potentialDictionaryCandidates
} from "./conjugation-explanation";
import type { TokenMorph } from "../types/furigana";

export interface TokenDictionaryEntry {
  id: number | string;
  /** Only JLPT words have a study id. Supplemental dictionary rows stay read-only. */
  studyWordId: number | null;
  source: "jlpt" | "supplement";
  kanji: string;
  kana: string;
  meaning: string;
  pos: string;
  verbType: string;
  jlptLevel: string;
  exampleJp: string;
  exampleMeaning: string;
  category: string;
  usageNote: string;
  sourceName: string;
  /** Exact dictionary form used by the successful lookup or recovery. */
  matchedForm: string;
}

const isKanaWritten = (text: string) => /^[ぁ-ゖァ-ヺー]+$/u.test(text) && text.length >= 2;
const hasKanji = (text: string) => /[\p{Script=Han}]/u.test(text);
const toHiragana = (text: string) => text.replace(/[ァ-ヶ]/gu, (char) => (
  String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
));
const firstKanji = (text: string) => [...text].find((char) => /[\p{Script=Han}]/u.test(char)) ?? "";
const isVerbPos = (pos: unknown) => /动词|動詞/u.test(String(pos ?? ""));

const rowToEntry = (row: Record<string, unknown>, matchedForm: string): TokenDictionaryEntry => ({
  id: String(row.lookup_source ?? "jlpt") === "supplement" ? String(row.id ?? "") : Number(row.id ?? 0),
  studyWordId: row.study_word_id == null ? null : Number(row.study_word_id),
  source: String(row.lookup_source ?? "jlpt") === "supplement" ? "supplement" : "jlpt",
  kanji: String(row.kanji ?? ""),
  kana: String(row.kana ?? ""),
  meaning: String(row.meaning ?? ""),
  pos: String(row.pos ?? ""),
  verbType: String(row.verb_type ?? ""),
  jlptLevel: String(row.jlpt_level ?? ""),
  exampleJp: String(row.example_jp ?? ""),
  exampleMeaning: String(row.example_meaning ?? ""),
  category: String(row.category ?? ""),
  usageNote: String(row.usage_note ?? ""),
  sourceName: String(row.source_name ?? ""),
  matchedForm
});

/**
 * Find dictionary entries for a baked kuromoji token.  This is deliberately
 * exact-match only: an inflected fragment such as 飛ば is not silently shown
 * as 飛ぶ.  The popup can report a miss instead of teaching the wrong word.
 */
export const lookupTokenEntries = (
  surface: string,
  reading = "",
  limit = 4,
  lemma = "",
  morphs: TokenMorph[] = []
): TokenDictionaryEntry[] => {
  const normalizedSurface = surface.trim();
  const normalizedLookup = lemma.trim() || normalizedSurface;
  if (!normalizedLookup) return [];
  const surfaceIsKana = isKanaWritten(normalizedSurface);

  try {
    const find = (query: string, allowKana = false) => rowsFor(`
      SELECT * FROM (
        SELECT
          CAST(id AS TEXT) AS id,
          id AS study_word_id,
          kanji,
          kana,
          meaning,
          pos,
          verb_type,
          jlpt_level,
          example_jp,
          example_meaning,
          importance AS lookup_priority,
          'jlpt' AS lookup_source,
          '' AS category,
          '' AS usage_note,
          '' AS source_name
        FROM words
        WHERE kanji = ? OR (? = 1 AND kana = ?)

        UNION ALL

        SELECT
          entry_key AS id,
          NULL AS study_word_id,
          headword AS kanji,
          kana,
          meaning,
          pos,
          verb_type,
          '' AS jlpt_level,
          example_jp,
          example_meaning,
          priority AS lookup_priority,
          'supplement' AS lookup_source,
          category,
          usage_note,
          source_name
        FROM dictionary_entries
        WHERE headword = ? OR (? = 1 AND kana = ?)
      ) AS dictionary_matches
      ORDER BY
        CASE
          WHEN kanji = ? THEN 0
          ELSE 1
        END,
        CASE WHEN lookup_source = 'jlpt' THEN 0 ELSE 1 END,
        lookup_priority DESC,
        id ASC
      LIMIT ?
    `, [
      query, allowKana ? 1 : 0, query,
      query, allowKana ? 1 : 0, query,
      query, limit
    ]);
    const toEntries = (rows: Record<string, unknown>[]) => rows.map((row) => (
      rowToEntry(row, String(row.kanji || row.kana || normalizedLookup))
    ));
    // A complete clicked block is useful when it contains written kanji
    // (申込書, 田中さんです, 早く, …).  For kana-only inflections, however,
    // the surface is often a homograph (した→下, しない→市内); let the
    // baked lemma win instead of treating the inflected spelling as a word.
    const queries = lemma.trim() && normalizedSurface !== normalizedLookup && hasKanji(normalizedSurface)
      ? [normalizedSurface, normalizedLookup]
      : [normalizedLookup];
    // Exact lookup always wins globally.  Do not let recovery for the whole
    // surface (される→さる) jump over an exact lemma lookup (する).
    for (const query of queries) {
      const direct = find(query, isKanaWritten(query) || (!lemma.trim() && surfaceIsKana));
      if (direct.length) return toEntries(direct as Record<string, unknown>[]);
    }

    const recoveryReadings = [reading, ...morphs.map((morph) => morph.reading ?? "")];
    for (const query of queries) {
      // Optional conjugation recovery: only runs after an exact miss, so words
      // such as 見える/聞こえる keep their own dictionary entry when present.
      for (const candidate of potentialDictionaryCandidates(query)) {
        const recovered = find(candidate, isKanaWritten(candidate)) as Record<string, unknown>[];
        const safeRecovered = recovered.filter((row) => {
          if (!isVerbPos(row.pos)) return false;
          if (isKnownVerbPair(query, candidate, reading, String(row.kana ?? ""))) return false;
          return recoveryReadings.some((tokenReading) => isPotentialReadingCompatible(
            tokenReading,
            String(row.kana ?? ""),
            String(row.verb_type ?? "")
          ));
        });
        if (safeRecovered.length) return toEntries(safeRecovered);
      }
    }

    // Orthographic variants such as 今さら/今更 share a reading but not a
    // kanji string.  Use the already aligned furigana reading only as a
    // guarded recovery: the candidate must preserve the first written kanji,
    // or the surface must be kana-only.  This rejects unrelated homophones
    // such as 思い→重い and 校則→高速/拘束.
    const readingCandidates = [
      ...morphs.slice(0, 1).map((morph) => morph.reading ?? ""),
      reading
    ].map((value) => toHiragana(value.trim())).filter(Boolean);
    for (const normalizedReading of readingCandidates) {
      const byReading = find(normalizedReading, true) as Record<string, unknown>[];
      const writtenHead = firstKanji(normalizedSurface);
      const guarded = byReading.filter((row) => (
        surfaceIsKana
        || (writtenHead && String(row.kanji ?? "").startsWith(writtenHead))
      ));
      if (guarded.length) return toEntries(guarded);
    }

    // Honorific prefixes are grammatical material, not part of the lexical
    // lookup key.  Keep the fallback narrow and only try it after all exact
    // and reading-based paths have failed.
    if (/^[おご]/u.test(normalizedLookup) && normalizedLookup.length > 1) {
      const stripped = find(normalizedLookup.slice(1), true);
      if (stripped.length) return toEntries(stripped as Record<string, unknown>[]);
    }
    return [];
  } catch {
    // A dictionary popup must never break grammar reading if a custom/imported
    // database has not finished opening or lacks the words table.
    return [];
  }
};
