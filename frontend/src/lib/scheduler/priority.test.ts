import { afterEach, describe, expect, it, vi } from "vitest";
import {
  priorityComponents,
  priorityScore,
  shouldPickStage1NewWord
} from "./priority";
import type { DbRow } from "../database/db-utils";

const DAY = 86_400_000;
/** 过期 n 天的 ISO 时间戳 */
const overdue = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const row = (overrides: DbRow = {}): DbRow => ({
  id: 1,
  seen_count: 1,
  importance: 3,
  fsrs_due: overdue(0),
  fsrs_lapses: 0,
  fsrs_state: 2,        // Review
  last_seen_on: null,
  shuffle_rank: 0,
  ...overrides
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("priorityComponents", () => {
  it("boosts new words by quota and shuffle instead of score gap", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const components = priorityComponents(row({ seen_count: 0, shuffle_rank: 0.5, importance: 4 }), undefined, 8);
    expect(components.new).toBe(45 + 8);
    expect(components.score).toBe(18);
    expect(components.shuffle).toBe(0.5 * 18);
    expect(components.importance).toBe(4 * 4);
  });

  it("越过期的词优先级越高(封顶 60,防陈年老账压过一切)", () => {
    const fresh = priorityComponents(row({ fsrs_due: overdue(1) }), undefined, 0);
    const stale = priorityComponents(row({ fsrs_due: overdue(5) }), undefined, 0);
    expect(stale.score).toBeGreaterThan(fresh.score);
    expect(priorityComponents(row({ fsrs_due: overdue(100) }), undefined, 0).score).toBe(60);
    expect(fresh.new).toBe(0);
    expect(fresh.review).toBe(35);
  });

  it("还没到期的复习词拿不到过期加分", () => {
    const future = new Date(Date.now() + 10 * DAY).toISOString();
    expect(priorityComponents(row({ fsrs_due: future }), undefined, 0).score).toBe(0);
  });

  it("学习/重学中的词排在「已见但没进过调度」之上——治『点了不认识就再也不回来』", () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();  // 十分钟后
    const relearning = priorityComponents(row({ fsrs_state: 3, fsrs_due: future }), undefined, 0);
    const unscheduled = priorityComponents(row({ fsrs_due: null }), undefined, 0);
    expect(relearning.score).toBeGreaterThan(unscheduled.score);
    expect(unscheduled.score).toBeGreaterThan(0);
  });

  it("错误史用 FSRS 的 lapses,不再叠加三个旧计数,而且封顶", () => {
    expect(priorityComponents(row({ fsrs_lapses: 3 }), undefined, 0).mistake).toBe(30);
    expect(priorityComponents(row({ fsrs_lapses: 0 }), undefined, 0).mistake).toBe(0);
    // 不封顶的话错 20 次拿 200 分,把过期程度(上限 60)整个压死
    expect(priorityComponents(row({ fsrs_lapses: 20 }), undefined, 0).mistake).toBe(40);
  });

  it("顽固词只拿一点加成,不再置顶", () => {
    // 旧行为是 120 分起、池子越挤加得越狠,结果几十个攻不下来的词统治整场。
    const leech = priorityComponents(row({ fsrs_lapses: 8, fsrs_due: overdue(1) }), undefined, 0);
    const ordinary = priorityComponents(row({ fsrs_lapses: 0, fsrs_due: overdue(1) }), undefined, 0);
    expect(leech.critical).toBe(12);
    expect(ordinary.critical).toBe(0);
    // 顽固词越多加得越狠的行为已经没有了:同样 lapses 的两个词加成完全一致
    const another = priorityComponents(row({ fsrs_lapses: 30, fsrs_due: overdue(1) }), undefined, 0);
    expect(another.critical).toBe(leech.critical);
  });

  it("promotes due queue entries and buries not-yet-due ones", () => {
    expect(priorityComponents(row(), 0, 0).queue).toBe(45);
    expect(priorityComponents(row(), 2, 0).queue).toBe(-80 - 2 * 25);
  });
});

describe("shouldPickStage1NewWord", () => {
  it("randomly interleaves new words according to the remaining daily mix", () => {
    // 第一张必定是旧词；200 个旧词、15 个新词时，新词约占 7%。
    expect(shouldPickStage1NewWord(200, 15, 0, 0)).toBe(false);
    expect(shouldPickStage1NewWord(200, 15, 1, 0.01)).toBe(true);
    expect(shouldPickStage1NewWord(200, 15, 1, 0.1)).toBe(false);
  });

  it("uses new words when no reviews remain", () => {
    expect(shouldPickStage1NewWord(0, 15, 0, 0.99)).toBe(true);
    expect(shouldPickStage1NewWord(200, 0, 3, 0)).toBe(false);
  });
});

describe("priorityScore", () => {
  it("sums all component values", () => {
    expect(priorityScore({ a: 10, b: -3, c: 0.5 })).toBeCloseTo(7.5);
  });
});

