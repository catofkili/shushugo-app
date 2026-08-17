import { describe, expect, it } from "vitest";
import { grammarPoints } from "../data/grammar";
import { grammarSequence } from "./grammar-numbering";

describe("grammar numbering", () => {
  it("restarts at one for every JLPT level", () => {
    for (const level of ["N5", "N4", "N3", "N2", "N1"] as const) {
      const points = grammarPoints.filter((point) => point.level === level);
      expect(grammarSequence(points[0])).toMatchObject({ level, ordinal: 1, total: points.length });
      expect(grammarSequence(points[points.length - 1])).toMatchObject({
        level,
        ordinal: points.length,
        total: points.length
      });
    }
  });

  it("formats a stable three-digit label", () => {
    const firstN3 = grammarPoints.find((point) => point.level === "N3")!;
    expect(grammarSequence(firstN3).label).toBe("N3 · 001");
  });
});
