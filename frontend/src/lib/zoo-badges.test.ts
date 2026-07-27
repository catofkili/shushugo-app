import { describe, expect, it } from "vitest";
import { computeBadges, HABITAT_CERTIFY_PCT } from "./zoo-badges";
import { computeStreak, weekDays } from "./zoo-streak";
import type { ProgressOverview } from "./study-types";

const overviewWith = (
  words: Partial<ProgressOverview["words"]> = {},
  wordsByLevel: ProgressOverview["wordsByLevel"] = []
): ProgressOverview => ({
  words: { total: 1000, completed: 0, low: 0, unseen: 0, ...words },
  wordsByLevel,
  grammar: []
});

describe("computeStreak", () => {
  it("今天已打卡时把今天算进连击", () => {
    expect(computeStreak(["2026-07-23", "2026-07-24", "2026-07-25"], "2026-07-25")).toBe(3);
  });

  it("今天还没打卡时从昨天往前数,不算断签", () => {
    expect(computeStreak(["2026-07-23", "2026-07-24"], "2026-07-25")).toBe(2);
  });

  it("中间断掉就只数到断点", () => {
    expect(computeStreak(["2026-07-20", "2026-07-24", "2026-07-25"], "2026-07-25")).toBe(2);
  });

  it("没有任何打卡记录是 0", () => {
    expect(computeStreak([], "2026-07-25")).toBe(0);
  });

  // 词库还没加载好时调用方会传空串,以前这里会 new Date(NaN).toISOString() 抛错炸掉整页
  it("today 非法(空串/乱码)时返回 0 而不是抛错", () => {
    expect(computeStreak(["2026-07-25"], "")).toBe(0);
    expect(computeStreak(["2026-07-25"], "not-a-date")).toBe(0);
  });

  it("跨月连击照样连得上", () => {
    expect(computeStreak(["2026-06-30", "2026-07-01"], "2026-07-01")).toBe(2);
  });
});

describe("weekDays", () => {
  it("周三返回本周一到周日七天", () => {
    // 2026-07-22 是周三
    expect(weekDays("2026-07-22")).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26"
    ]);
  });

  it("today 非法时返回空数组而不是抛错", () => {
    expect(weekDays("")).toEqual([]);
  });

  it("周日属于「上一个周一」开头的那一周,不会把自己甩成下周", () => {
    // 2026-07-26 是周日
    expect(weekDays("2026-07-26")[0]).toBe("2026-07-20");
    expect(weekDays("2026-07-26")[6]).toBe("2026-07-26");
  });
});

describe("computeBadges", () => {
  const base = { overview: overviewWith(), checkins: [], studyDate: "2026-07-25" };

  it("零进度时一个都不解锁", () => {
    const badges = computeBadges(base);
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.every((badge) => !badge.unlocked)).toBe(true);
  });

  it("园区掌握度达到阈值才认证", () => {
    const justUnder = computeBadges({
      ...base,
      overview: overviewWith({}, [{ level: "N5", total: 100, completed: HABITAT_CERTIFY_PCT - 1, low: 0, unseen: 0 }])
    }).find((badge) => badge.id === "habitat-N5");
    expect(justUnder?.unlocked).toBe(false);

    const justAt = computeBadges({
      ...base,
      overview: overviewWith({}, [{ level: "N5", total: 100, completed: HABITAT_CERTIFY_PCT, low: 0, unseen: 0 }])
    }).find((badge) => badge.id === "habitat-N5");
    expect(justAt?.unlocked).toBe(true);
  });

  it("等级里一个词都没有时算 0%,不会除以零变 NaN", () => {
    const badge = computeBadges({
      ...base,
      overview: overviewWith({}, [{ level: "N5", total: 0, completed: 0, low: 0, unseen: 0 }])
    }).find((item) => item.id === "habitat-N5");
    expect(badge?.current).toBe(0);
    expect(badge?.unlocked).toBe(false);
  });

  it("连续打卡按 streak 解锁,累计天数按去重后的总数解锁", () => {
    // 连续 3 天,但历史上一共打过 4 天(其中一天是很久以前)
    const checkins = ["2025-01-01", "2026-07-23", "2026-07-24", "2026-07-25"];
    const badges = computeBadges({ ...base, checkins });
    expect(badges.find((badge) => badge.id === "streak-3")?.unlocked).toBe(true);
    expect(badges.find((badge) => badge.id === "streak-7")?.unlocked).toBe(false);
    expect(badges.find((badge) => badge.id === "days-10")?.current).toBe(4);
  });

  it("进度值不会超过目标值(进度条不会画爆)", () => {
    const badges = computeBadges({ ...base, overview: overviewWith({ completed: 99999 }) });
    badges
      .filter((badge) => badge.group === "words")
      .forEach((badge) => expect(badge.current).toBeLessThanOrEqual(badge.target));
  });
});
