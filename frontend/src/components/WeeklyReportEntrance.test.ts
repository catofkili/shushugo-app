import { describe, expect, it } from "vitest";
import { cordPullDistance, cordPullOpens } from "./WeeklyReportEntrance";

describe("weekly report cord", () => {
  it("follows the initial pull and adds resistance without a hard stop", () => {
    expect(cordPullDistance(-10)).toBe(0);
    expect(cordPullDistance(64)).toBe(64);
    expect(cordPullDistance(96.001) - cordPullDistance(96)).toBeCloseTo(.001, 5);
    expect(cordPullDistance(240)).toBeGreaterThan(110);
    expect(cordPullDistance(480)).toBeGreaterThan(cordPullDistance(240));
    expect(cordPullDistance(600)-cordPullDistance(480)).toBeLessThan(cordPullDistance(360)-cordPullDistance(240));
  });
  it("opens with a modest downward pull, allows a natural diagonal, and rejects taps or horizontal drags", () => {
    expect(cordPullOpens(0, 26)).toBe(false);
    expect(cordPullOpens(30, 64)).toBe(true);
    expect(cordPullOpens(150, 70)).toBe(false);
    expect(cordPullOpens(0, -100)).toBe(false);
  });
});
