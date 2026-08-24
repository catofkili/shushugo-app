import { describe, expect, it } from "vitest";
import payload from "../data/kanji_reading_unit_index.json";
import {
  KANJI_READING_UNIT_INDEX_VERSION,
  kanjiUnitNaturalKey,
  type KanjiReadingUnitIndex
} from "./kanji-reading-units";

const index = payload as KanjiReadingUnitIndex;

describe("kanji reading unit index contract", () => {
  it("is a deterministic seed-only content index", () => {
    expect(index.version).toBe(KANJI_READING_UNIT_INDEX_VERSION);
    expect(index.source.database).toBe("public/nihongo.db");
    expect(index.source.liveDatabase).toBe(false);
    expect(index.units.length).toBeGreaterThan(0);

    const keys = index.units.map((unit) => kanjiUnitNaturalKey(unit));
    expect(new Set(keys).size).toBe(keys.length);
    expect(index.units).toEqual([...index.units].sort((left, right) => left.unitKey.localeCompare(right.unitKey, "ja")));
  });

  it("keeps every occurrence attached to a declared unit and a valid segment", () => {
    const units = new Set(index.units.map((unit) => unit.unitKey));
    for (const occurrence of index.occurrences) {
      expect(units.has(occurrence.unitKey)).toBe(true);
      expect(occurrence.exampleWordId).toBeGreaterThan(0);
      expect(occurrence.targetSegment.start).toBeGreaterThanOrEqual(0);
      expect(occurrence.targetSegment.length).toBeGreaterThan(0);
      expect(occurrence.reading.length).toBeGreaterThan(0);
      expect(occurrence.variant.length).toBeGreaterThan(0);
    }
    const iterationOccurrences = index.occurrences.filter((occurrence) => occurrence.targetSegment.text === "々");
    expect(iterationOccurrences.length).toBeGreaterThan(0);
    expect(iterationOccurrences.every((occurrence) => occurrence.targetSegment.length === 1)).toBe(true);
    expect(index.units.every((unit) => !unit.unitKey.includes("\u0000"))).toBe(true);
  });

  it("keeps the complete manual-review audit while shipping only reviewed units", () => {
    expect(index.stats.unresolvedWords).toBe(index.unresolved.length);
    expect(index.stats.ambiguousWords).toBe(index.alignmentTies.length);
    expect(index.stats.tieCases).toBeGreaterThanOrEqual(index.stats.ambiguousWords);
    expect(index.stats.jukujikunCandidates).toBeGreaterThan(0);
    expect(index.stats.reviewedUnresolvedCandidates).toBeGreaterThan(0);
    expect(index.stats.reviewedAlignmentTies).toBeGreaterThan(0);
    expect(index.unresolved).toHaveLength(0);
    expect(index.alignmentTies).toHaveLength(0);
    expect(index.manualReviewLog.length).toBe(index.stats.manualReviewCount);
    expect(index.manualReviewLog.every((item) => item.exampleWordId > 0 && item.surface && item.reading && item.decision)).toBe(true);
    expect(index.manualReview).toHaveLength(200);
    expect(new Set(index.manualReview.map((item) => item.stratum)).size).toBeGreaterThan(1);
    expect(index.units.some((unit) => unit.unitType === "jukujikun")).toBe(true);
    expect(index.stats.jukujikunUnitCount).toBe(110);
  });
});
