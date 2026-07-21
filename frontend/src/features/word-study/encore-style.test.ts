import { describe, expect, it } from "vitest";
import { encoreWeekKey } from "../../lib/comeback";
import {
  ENCORE_DAY_COLORS,
  encoreDayColor,
  nextMilestone,
  nextRoundTarget,
  pickEncoreHook
} from "./encore-style";

const input = (overrides: Partial<Parameters<typeof pickEncoreHook>[0]> = {}) => ({
  studyDate: "2026-07-16",
  todayWordCount: 60,
  weekEncoreCount: 0,
  recommendedSize: 20,
  totalLearned: 850,
  ...overrides
});

describe("encoreDayColor", () => {
  it("maps weekday to the fixed 七曜 color", () => {
    // 2026-07-16 是木曜日
    expect(encoreDayColor("2026-07-16").weekdayJp).toBe("木曜日");
    expect(encoreDayColor("2026-07-12").weekdayJp).toBe("日曜日");
    expect(ENCORE_DAY_COLORS).toHaveLength(7);
  });

  it("keeps button text readable: every color has a same-family dark ink", () => {
    for (const color of ENCORE_DAY_COLORS) {
      expect(color.hex).toMatch(/^#[0-9A-F]{6}$/i);
      expect(color.ink).toMatch(/^#[0-9A-F]{6}$/i);
      expect(color.ink).not.toBe(color.hex);
    }
  });
});

describe("nextRoundTarget", () => {
  it("rounds up to the next multiple of 100", () => {
    expect(nextRoundTarget(0)).toBe(100);
    expect(nextRoundTarget(87)).toBe(100);
    expect(nextRoundTarget(100)).toBe(200);
    expect(nextRoundTarget(193)).toBe(200);
  });
});

describe("nextMilestone", () => {
  it("finds the next cumulative milestone", () => {
    expect(nextMilestone(0)).toBe(100);
    expect(nextMilestone(999)).toBe(1000);
    expect(nextMilestone(1000)).toBe(2000);
    expect(nextMilestone(99999)).toBeNull();
  });
});

describe("pickEncoreHook 巧合层", () => {
  it("里程碑最稀有、优先级最高:差得少才出现,数量对齐 gap", () => {
    const hook = pickEncoreHook(input({ totalLearned: 988, recommendedSize: 20 }));
    expect(hook.kind).toBe("milestone");
    expect(hook.suggestedSize).toBe(12);
    expect(hook.lead).toContain("1000");
  });

  it("里程碑差太多时不强求", () => {
    const hook = pickEncoreHook(input({ totalLearned: 900, recommendedSize: 20 }));
    expect(hook.kind).not.toBe("milestone");
  });

  it("日凑整只在顺手时出现(gap ≤ min(15, 推荐量)),目标为整百", () => {
    const hook = pickEncoreHook(input({ todayWordCount: 87, recommendedSize: 20 }));
    expect(hook.kind).toBe("round");
    expect(hook.suggestedSize).toBe(13);
    expect(hook.lead).toContain("100");
    // 差 40 个不算顺手
    expect(pickEncoreHook(input({ todayWordCount: 60 })).kind).not.toBe("round");
    // 推荐量太小时凑整也不硬凑
    expect(pickEncoreHook(input({ todayWordCount: 87, recommendedSize: 5 })).kind).not.toBe("round");
  });

  it("gap 太小(<3)不值得当钩子", () => {
    expect(pickEncoreHook(input({ todayWordCount: 98 })).kind).not.toBe("round");
  });
});

describe("pickEncoreHook 常驻层", () => {
  it("无巧合时按日期在常驻钩子里轮换,连击钩子要求本周加过餐", () => {
    const days = ["2026-07-13", "2026-07-14", "2026-07-15"];
    const kinds = days.map((studyDate) =>
      pickEncoreHook(input({ studyDate, weekEncoreCount: 2 })).kind
    );
    expect(new Set(kinds).size).toBe(3);
    expect(kinds.every((kind) => ["streak", "badge", "color"].includes(kind))).toBe(true);
  });

  it("本周没加过餐就没有连击钩子", () => {
    const days = ["2026-07-13", "2026-07-14", "2026-07-15"];
    const kinds = days.map((studyDate) =>
      pickEncoreHook(input({ studyDate, weekEncoreCount: 0 })).kind
    );
    expect(kinds.every((kind) => ["badge", "color"].includes(kind))).toBe(true);
  });
});

describe("encoreWeekKey", () => {
  it("uses the week's Sunday as the key", () => {
    expect(encoreWeekKey("2026-07-16")).toBe("2026-07-12");
    expect(encoreWeekKey("2026-07-12")).toBe("2026-07-12");
    expect(encoreWeekKey("2026-07-18")).toBe("2026-07-12");
    expect(encoreWeekKey("2026-07-19")).toBe("2026-07-19");
  });
});
