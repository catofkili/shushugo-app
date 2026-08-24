/**
 * Build-time contract for kanji-reading cards.
 *
 * The JSON index is content, not user state. `unitKey` is the stable natural
 * key used while materialising local `unit_id` rows; ids must never be synced.
 */

export const KANJI_READING_UNIT_INDEX_VERSION = "2026-08-22-kanji-reading-units-v1";

export type KanjiUnitType = "char" | "jukujikun";
export type KanjiReadingKind = "on" | "kun";

export interface KanjiReadingUnit {
  unitKey: string;
  unitType: KanjiUnitType;
  /** Filled for char units; empty for jukujikun units. */
  char: string;
  /** KANJIDIC base reading for char units; empty for jukujikun units. */
  base: string;
  /** Surface/reading are only filled for jukujikun units. */
  surface: string;
  reading: string;
  /** Sorted and deduplicated so exports are deterministic. */
  kinds: KanjiReadingKind[];
}

export interface KanjiReadingOccurrence {
  unitKey: string;
  exampleWordId: number;
  /** UTF-16 offsets into the seed word's kanji surface. */
  targetSegment: { start: number; length: number; text: string };
  /** Actual reading in this word, including rendaku/促音/送り仮名 variants. */
  reading: string;
  variant: string;
}

export interface KanjiReadingUnitIndex {
  version: string;
  generatedBy: string;
  source: {
    database: string;
    liveDatabase: false;
    wordCount: number;
    sha256: string;
    readingsSha256: string;
  };
  units: KanjiReadingUnit[];
  occurrences: KanjiReadingOccurrence[];
  unresolved: Array<{
    exampleWordId: number;
    surface: string;
    reading: string;
    reason: string;
    importance: number;
    jlptLevel: string;
  }>;
  alignmentTies: Array<{
    exampleWordId: number;
    surface: string;
    reading: string;
    reason: "alignment-tie";
    tieCount: number;
    importance: number;
    jlptLevel: string;
  }>;
  manualReview: Array<{
    exampleWordId: number;
    surface: string;
    reading: string;
    reason: string;
    stratum: string;
    suggestedUnitType: KanjiUnitType;
  }>;
  manualReviewLog: Array<{
    exampleWordId: number;
    surface: string;
    reading: string;
    normalizedSurface?: string;
    normalizedReading?: string;
    reason: string;
    decision: string;
    manualUnitCount: number;
    tieCount?: number;
    importance: number;
    jlptLevel: string;
  }>;
  manualReviewPolicy?: {
    officialJukujikunCatalog?: string;
    officialSource?: string;
    additionalPolicy?: string;
    unresolvedDecision?: string;
  };
  stats: {
    wordCount: number;
    wordsWithKanji: number;
    alignedWords: number;
    jukujikunCandidates: number;
    jukujikunUnits?: number;
    jukujikunUnitCount: number;
    reviewedUnresolvedCandidates?: number;
    reviewedAlignmentTies?: number;
    unresolvedWords: number;
    tieCases: number;
    ambiguousWords: number;
    manualReviewCount: number;
    manualReviewSampleCount?: number;
    expandedIterationMarks: number;
  };
}

export const kanjiUnitNaturalKey = (unit: Pick<KanjiReadingUnit, "unitType" | "char" | "base" | "surface" | "reading">) =>
  [unit.unitType, unit.char, unit.base, unit.surface, unit.reading].join("|");

export const compareKanjiUnit = (left: KanjiReadingUnit, right: KanjiReadingUnit) =>
  left.unitKey.localeCompare(right.unitKey, "ja");
