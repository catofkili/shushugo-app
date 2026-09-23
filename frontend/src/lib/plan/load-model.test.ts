import { describe, expect, it } from "vitest";
import { predictLoad, tierOf } from "./load-model";

describe("plan load preview", () => {
  it("keeps units consistent and computes the peak instead of assuming week four", () => {
    const result = predictLoad({ dailyNew: { words: 38, grammar: 3, kanji: 0, confusion: 0 }, weeks: 8 });
    expect(result.perWeek).toHaveLength(8);
    expect(result.perWeek[0].minutes).toBeGreaterThan(0);
    expect(result.peakWeek).toBe(8);
    expect(result.steadyMinutes).toBeGreaterThan(60);
  });

  it("stops adding cohorts after the intake window", () => {
    const result = predictLoad({ dailyNew: { words: 20, grammar: 0, kanji: 0, confusion: 0 }, intakeDaysLeft: 7, weeks: 8 });
    expect(result.perWeek[7].minutes).toBeLessThan(result.perWeek[0].minutes);
  });

  it("uses the agreed coarse tiers", () => {
    expect([tierOf(30), tierOf(60), tierOf(90), tierOf(91)]).toEqual(["light", "steady", "heavy", "aggressive"]);
  });
});
