import { describe, expect, it } from "vitest";
import {
  BACKLOG_SPREAD_DAYS,
  CONSOLIDATION_DAYS,
  MAX_DAILY_NEW_WORDS,
  computeDailyMinimum,
  daysBetween,
  levelsInScope,
  shortfallOf,
  shortfallText,
  type PlanInputs
} from "./plan";
import { firstSundayOf, nextExamDate, parseExamDate } from "./exam-dates";

const inputs = (overrides: Partial<PlanInputs> = {}): PlanInputs => ({
  today: new Date(2026, 7, 14),      // 2026-08-14
  examDate: new Date(2026, 11, 6),   // 2026-12-06,114 天后
  unseenWords: 0,
  unseenGrammar: 0,
  freshDueWords: 0,
  overdueWords: 0,
  freshDueGrammar: 0,
  overdueGrammar: 0,
  ...overrides
});

describe("levelsInScope", () => {
  it("covers the target level and everything below it", () => {
    // JLPT 考累计内容:N3 的卷子里 N4/N5 照样出
    expect(levelsInScope("N3")).toEqual(["N5", "N4", "N3"]);
    expect(levelsInScope("N5")).toEqual(["N5"]);
    expect(levelsInScope("N1")).toEqual(["N5", "N4", "N3", "N2", "N1"]);
  });
});

describe("exam dates", () => {
  it("finds the first Sunday of July and December", () => {
    expect(firstSundayOf(2026, 12)).toEqual(new Date(2026, 11, 6));
    expect(firstSundayOf(2026, 7)).toEqual(new Date(2026, 6, 5));
  });

  it("treats exam day itself as still upcoming", () => {
    expect(nextExamDate(new Date(2026, 11, 6, 9))).toEqual(new Date(2026, 11, 6));
  });

  it("rolls over to next July after December", () => {
    expect(nextExamDate(new Date(2026, 11, 7))).toEqual(new Date(2027, 6, 4));
  });

  it("rejects malformed and non-existent dates", () => {
    expect(parseExamDate("2026-12-06")).toEqual(new Date(2026, 11, 6));
    expect(parseExamDate("2026/12/06")).toBeNull();
    expect(parseExamDate("2026-02-30")).toBeNull();
  });
});

describe("computeDailyMinimum", () => {
  it("spreads unseen content over the intake window, not the whole countdown", () => {
    const plan = computeDailyMinimum(inputs({ unseenWords: 1898, unseenGrammar: 390 }));
    // 114 天里最后 21 天不进新内容 → 93 天摊完
    expect(plan.daysLeft).toBe(114);
    expect(plan.intakeDaysLeft).toBe(114 - CONSOLIDATION_DAYS);
    expect(plan.newWords).toBe(Math.ceil(1898 / 93));
    expect(plan.newGrammar).toBe(Math.ceil(390 / 93));
    expect(plan.phase).toBe("intake");
    expect(plan.feasible).toBe(true);
  });

  it("stops introducing new content inside the consolidation window", () => {
    const plan = computeDailyMinimum(inputs({
      today: new Date(2026, 10, 25),   // 距考试 11 天
      unseenWords: 500,
      unseenGrammar: 100,
      freshDueWords: 40
    }));
    expect(plan.phase).toBe("consolidate");
    expect(plan.newWords).toBe(0);
    expect(plan.newGrammar).toBe(0);
    // 复习照做
    expect(plan.reviewWords).toBe(40);
  });

  it("amortises the overdue backlog instead of demanding it all today", () => {
    const plan = computeDailyMinimum(inputs({ freshDueWords: 94, overdueWords: 669 }));
    expect(plan.reviewWords).toBe(94 + Math.ceil(669 / BACKLOG_SPREAD_DAYS));
    // 关键:不是 763
    expect(plan.reviewWords).toBeLessThan(763);
  });

  it("collapses the backlog window when the exam is closer than the spread", () => {
    const plan = computeDailyMinimum(inputs({
      today: new Date(2026, 11, 3),   // 距考试 3 天
      freshDueWords: 10,
      overdueWords: 60
    }));
    expect(plan.reviewWords).toBe(10 + Math.ceil(60 / 3));
  });

  it("flags an impossible plan instead of demanding an absurd daily quota", () => {
    const plan = computeDailyMinimum(inputs({
      today: new Date(2026, 10, 1),   // 距考试 35 天,只剩 14 天能进新词
      unseenWords: 3000
    }));
    expect(plan.feasible).toBe(false);
    expect(plan.newWords).toBe(MAX_DAILY_NEW_WORDS);
    // 按上限也要 60 天 + 21 天巩固期
    expect(plan.daysNeeded).toBe(Math.ceil(3000 / MAX_DAILY_NEW_WORDS) + CONSOLIDATION_DAYS);
  });

  it("puts everything on today once the exam has arrived", () => {
    const plan = computeDailyMinimum(inputs({
      today: new Date(2026, 11, 6),
      freshDueWords: 5,
      overdueWords: 40
    }));
    expect(plan.daysLeft).toBe(0);
    expect(plan.phase).toBe("exam-week");
    expect(plan.reviewWords).toBe(45);
  });

  it("reports a past exam without producing negative work", () => {
    const plan = computeDailyMinimum(inputs({ today: new Date(2026, 11, 7), unseenWords: 500 }));
    expect(plan.phase).toBe("past");
    expect(plan.newWords).toBe(0);
    expect(plan.intakeDaysLeft).toBe(0);
  });
});

describe("daysBetween", () => {
  it("ignores the time of day", () => {
    expect(daysBetween(new Date(2026, 7, 14, 23, 59), new Date(2026, 7, 15, 0, 1))).toBe(1);
  });
});

describe("shortfallOf", () => {
  const plan = computeDailyMinimum(inputs({ unseenWords: 1898, freshDueWords: 60 }));

  it("never reports negative shortfall when you overshoot", () => {
    const gap = shortfallOf(plan, {
      newWordsDone: 999,
      reviewWordsDone: 999,
      newGrammarDone: 999,
      reviewGrammarDone: 999
    });
    expect(gap.newWords).toBe(0);
    expect(gap.clear).toBe(true);
    expect(shortfallText(gap)).toBe("今天的最低量已经做完了");
  });

  it("lists review before new words — clearing due matters more than intake", () => {
    const gap = shortfallOf(plan, {
      newWordsDone: 0,
      reviewWordsDone: 0,
      newGrammarDone: 0,
      reviewGrammarDone: 0
    });
    expect(shortfallText(gap)).toMatch(/^还差 复习 60 · 新词 \d+/);
  });
});
