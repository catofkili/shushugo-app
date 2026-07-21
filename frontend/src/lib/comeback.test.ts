import { describe, expect, it } from "vitest";
import {
  comebackCapacity,
  comebackDailyTarget,
  comebackPlanDays,
  encoreChunkSize,
  estimatedMinutesFor,
  shouldActivateComeback,
  type ComebackState
} from "./comeback";

const baseTrigger = {
  checkinDays: 30,
  missedDays: 3,
  backlog: 700,
  avgDailyWords: 80,
  secondsPerWord: 12,
  capacity: 120
};

describe("comebackCapacity", () => {
  it("clamps to [60, 150]", () => {
    expect(comebackCapacity(0)).toBe(60);
    expect(comebackCapacity(20)).toBe(60);
    expect(comebackCapacity(80)).toBe(120);
    expect(comebackCapacity(200)).toBe(150);
  });
});

describe("encoreChunkSize", () => {
  it("shrinks with the remaining backlog (50→30→20→10→5 style)", () => {
    expect(encoreChunkSize(600)).toBe(50);
    expect(encoreChunkSize(100)).toBe(30);
    expect(encoreChunkSize(60)).toBe(20);
    expect(encoreChunkSize(30)).toBe(10);
    expect(encoreChunkSize(12)).toBe(5);
  });

  it("never exceeds what is left", () => {
    expect(encoreChunkSize(4)).toBe(4);
    expect(encoreChunkSize(1)).toBe(1);
    expect(encoreChunkSize(0)).toBe(0);
    expect(encoreChunkSize(-3)).toBe(0);
  });
});

describe("shouldActivateComeback", () => {
  it("activates for a heavy backlog after a real absence", () => {
    expect(shouldActivateComeback(baseTrigger)).toBe(true);
  });

  it("requires at least a week of checkin history", () => {
    expect(shouldActivateComeback({ ...baseTrigger, checkinDays: 6 })).toBe(false);
    expect(shouldActivateComeback({ ...baseTrigger, checkinDays: 7 })).toBe(true);
  });

  it("requires at least two fully missed days", () => {
    expect(shouldActivateComeback({ ...baseTrigger, missedDays: 1 })).toBe(false);
    expect(shouldActivateComeback({ ...baseTrigger, missedDays: 2 })).toBe(true);
  });

  it("skips backlogs that fit into a single day's capacity", () => {
    expect(shouldActivateComeback({ ...baseTrigger, backlog: 120 })).toBe(false);
  });

  it("triggers by estimated time even when the count ratio is mild", () => {
    // 平时量大（日均 200），积压 350 不到 2 倍，但按每词 12 秒要 70 分钟
    expect(shouldActivateComeback({
      ...baseTrigger,
      avgDailyWords: 200,
      capacity: comebackCapacity(200),
      backlog: 350
    })).toBe(true);
  });

  it("stays quiet for a light backlog", () => {
    expect(shouldActivateComeback({
      ...baseTrigger,
      avgDailyWords: 100,
      capacity: 150,
      backlog: 160,
      secondsPerWord: 8
    })).toBe(false);
  });
});

describe("comebackPlanDays", () => {
  it("温和档固定 7 天", () => {
    expect(comebackPlanDays("gentle", 660)).toBe(7);
    expect(comebackPlanDays("gentle", 120)).toBe(7);
  });

  it("高强度按积压 2~3 天(小积压 1 天),封顶 3", () => {
    expect(comebackPlanDays("pressure", 660)).toBe(3);
    expect(comebackPlanDays("pressure", 400)).toBe(2);
    expect(comebackPlanDays("pressure", 150)).toBe(1);
    expect(comebackPlanDays("pressure", 5000)).toBe(3);
  });
});

describe("comebackDailyTarget", () => {
  const state = (mode: "gentle" | "pressure", planDays: number): ComebackState => ({
    active: true, startedOn: "2026-07-01", initialBacklog: 660, planDays,
    capacity: 150, mode, evaluatedOn: "", announcedOn: ""
  });

  it("温和档由轻到重,且当天量随剩余自我校正(660 → 47…141)", () => {
    const s = state("gentle", 7);
    // 每天用「上一天真实清完后的剩余」推进,复现 47/63/79/94/110/126/141
    let remaining = 660;
    const seen: number[] = [];
    for (let day = 1; day <= 7; day += 1) {
      const t = comebackDailyTarget(s, day, remaining);
      seen.push(t);
      remaining -= t;
    }
    expect(seen).toEqual([47, 63, 79, 94, 110, 126, 141]);
    expect(remaining).toBe(0);
    // 严格递增
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("温和档超期不砸盘:封在 CAPACITY_MAX 以内", () => {
    expect(comebackDailyTarget(state("gentle", 7), 9, 900)).toBeLessThanOrEqual(150);
  });

  it("高强度把剩余均摊到剩余天数(尽快清)", () => {
    const s = state("pressure", 3);
    expect(comebackDailyTarget(s, 1, 660)).toBe(220);
    expect(comebackDailyTarget(s, 2, 440)).toBe(220);
    expect(comebackDailyTarget(s, 3, 220)).toBe(220);
  });

  it("没有积压就不放词", () => {
    expect(comebackDailyTarget(state("gentle", 7), 1, 0)).toBe(0);
  });
});

describe("estimatedMinutesFor", () => {
  it("rounds up and never returns 0 for a non-empty batch", () => {
    expect(estimatedMinutesFor(50, 12)).toBe(10);
    expect(estimatedMinutesFor(1, 12)).toBe(1);
    expect(estimatedMinutesFor(0, 12)).toBe(0);
  });
});
