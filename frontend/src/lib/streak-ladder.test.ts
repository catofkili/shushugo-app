import { describe, expect, it } from "vitest";
import {
  applyLadderDecay,
  ladderDecayRate,
  nextRightStreak,
  shouldAutoRetire
} from "./streak-ladder";

const row = (overrides: Partial<Parameters<typeof ladderDecayRate>[0]> = {}) => ({
  importance: 3,
  right_count: 0,
  fuzzy_count: 0,
  forgot_count: 0,
  right_streak: 0,
  ...overrides
});

describe("ladderDecayRate", () => {
  it("halves per streak level: 2.0 → 1.0 → 0.5 → 0.25", () => {
    expect(ladderDecayRate(row())).toBe(2.0);
    expect(ladderDecayRate(row({ right_streak: 1 }))).toBe(1.0);
    expect(ladderDecayRate(row({ right_streak: 2 }))).toBe(0.5);
    expect(ladderDecayRate(row({ right_streak: 3 }))).toBe(0.25);
  });

  it("never drops below 0.25 regardless of streak", () => {
    expect(ladderDecayRate(row({ right_streak: 10 }))).toBe(0.25);
  });

  it("clamps the mistake/importance adjusted base to [1.6, 2.4]", () => {
    // 错误史很重:base 2.0 + 0.4 → 2.4
    expect(ladderDecayRate(row({ forgot_count: 10 }))).toBe(2.4);
    // 低重要度 + 高正确率:2.0 - 0.4 - 0.2 → 夹到 1.6
    expect(ladderDecayRate(row({ importance: 1, right_count: 10 }))).toBe(1.6);
  });

  it("等效间隔:从封顶 20 分衰减到 6 分,连胜 0/1/2/3 约 7/14/28/56 天", () => {
    for (const [streak, days] of [[0, 7], [1, 14], [2, 28], [3, 56]] as const) {
      expect(Math.ceil(14 / ladderDecayRate(row({ right_streak: streak })))).toBe(days);
    }
  });
});

describe("applyLadderDecay", () => {
  it("positive scores decay and stop at 0", () => {
    expect(applyLadderDecay(10, 2)).toBe(8);
    expect(applyLadderDecay(1, 2)).toBe(0);
  });

  it("被顺延的到期词不再被扣成危急:0 分保持 0", () => {
    expect(applyLadderDecay(0, 2)).toBe(0);
  });

  it("deep-negative scores lift to -9 (旧语义保留)", () => {
    expect(applyLadderDecay(-40, 2)).toBe(-9);
    expect(applyLadderDecay(-5, 2)).toBe(-5);
  });
});

describe("nextRightStreak", () => {
  it("当天首见 + 非深坑 + 答对才 +1", () => {
    expect(nextRightStreak(1, "know", true, 4)).toBe(2);
    expect(nextRightStreak(1, "know", true, 0)).toBe(2);
  });

  it("深坑爬坡时答对不加也不清", () => {
    expect(nextRightStreak(2, "know", true, -9)).toBe(2);
  });

  it("非首见答对不加", () => {
    expect(nextRightStreak(2, "know", false, 4)).toBe(2);
  });

  it("模糊/忘记一律清零", () => {
    expect(nextRightStreak(3, "fuzzy", true, 4)).toBe(0);
    expect(nextRightStreak(3, "forgot", false, -9)).toBe(0);
  });
});

describe("shouldAutoRetire", () => {
  it("3 连胜 + 分数达标退休;有 -20 前科要 5 连胜", () => {
    expect(shouldAutoRetire(3, 20, false)).toBe(true);
    expect(shouldAutoRetire(3, 20, true)).toBe(false);
    expect(shouldAutoRetire(5, 20, true)).toBe(true);
  });

  it("分数不足不退休", () => {
    expect(shouldAutoRetire(3, 14, false)).toBe(false);
  });
});
