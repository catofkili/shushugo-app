import { describe, expect, it } from "vitest";
import {
  LONG_STEP_GAP,
  LONG_STEP_MINUTES,
  SHORT_STEP_GAP,
  STUBBORN_MISTAKE_STREAK,
  allowsBackToBack,
  requeueGap
} from "./requeue";

const lowest = (min: number) => min;
const highest = (_min: number, max: number) => max;

describe("requeueGap", () => {
  it("keeps the short step off the user's face", () => {
    // 答错退回第一步(1m):最快也要过 3 张才再出——立刻再考等于抄写
    expect(requeueGap(1, lowest)).toBe(SHORT_STEP_GAP[0]);
    expect(requeueGap(1, highest)).toBe(SHORT_STEP_GAP[1]);
    expect(SHORT_STEP_GAP[0]).toBeGreaterThanOrEqual(3);
  });

  it("pushes the long step much further back", () => {
    expect(requeueGap(10, lowest)).toBe(LONG_STEP_GAP[0]);
    expect(requeueGap(10, highest)).toBe(LONG_STEP_GAP[1]);
    expect(LONG_STEP_GAP[0]).toBeGreaterThan(SHORT_STEP_GAP[1]);
  });

  it("switches step length at the minute threshold", () => {
    expect(requeueGap(LONG_STEP_MINUTES - 0.1, lowest)).toBe(SHORT_STEP_GAP[0]);
    expect(requeueGap(LONG_STEP_MINUTES, lowest)).toBe(LONG_STEP_GAP[0]);
  });

  it("randomises inside the range so the rhythm is not predictable", () => {
    const seen = new Set(Array.from({ length: 200 }, () => requeueGap(1)));
    expect(seen.size).toBeGreaterThan(1);
    seen.forEach((gap) => {
      expect(gap).toBeGreaterThanOrEqual(SHORT_STEP_GAP[0]);
      expect(gap).toBeLessThanOrEqual(SHORT_STEP_GAP[1]);
    });
  });
});

describe("allowsBackToBack", () => {
  const plenty = { remaining: 40, total: 100 };

  it("keeps normal words apart mid-session", () => {
    expect(allowsBackToBack({ mistakeStreak: 0, ...plenty })).toBe(false);
    expect(allowsBackToBack({ mistakeStreak: STUBBORN_MISTAKE_STREAK - 1, ...plenty })).toBe(false);
  });

  it("drills a stubborn word on the spot", () => {
    // 连着错到阈值:隔开等于放它跑,不如刷到答对(答对即清零 streak,自动退出连出)
    expect(allowsBackToBack({ mistakeStreak: STUBBORN_MISTAKE_STREAK, ...plenty })).toBe(true);
  });

  it("stops enforcing the gap in the last tenth of the day", () => {
    expect(allowsBackToBack({ mistakeStreak: 0, remaining: 11, total: 100 })).toBe(false);
    expect(allowsBackToBack({ mistakeStreak: 0, remaining: 10, total: 100 })).toBe(true);
    expect(allowsBackToBack({ mistakeStreak: 0, remaining: 1, total: 6 })).toBe(true); // 向上取整,小任务也留余地
  });

  it("does not divide by an empty task list", () => {
    expect(allowsBackToBack({ mistakeStreak: 0, remaining: 0, total: 0 })).toBe(false);
  });
});
