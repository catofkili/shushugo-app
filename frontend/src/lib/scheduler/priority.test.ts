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
  fsrs_stability: 5,
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

  it("越陌生(stability 越低)优先级越高,老朋友(≥30 天)归零", () => {
    const yesterday = priorityComponents(row({ fsrs_stability: 0.3, fsrs_due: overdue(0) }), undefined, 0);
    const shaky = priorityComponents(row({ fsrs_stability: 3 }), undefined, 0);
    const friend = priorityComponents(row({ fsrs_stability: 30, fsrs_due: overdue(14) }), undefined, 0);
    expect(yesterday.score).toBeGreaterThan(shaky.score);
    expect(shaky.score).toBeGreaterThan(friend.score);
    expect(friend.score).toBe(0);
    expect(yesterday.score).toBeLessThanOrEqual(50);
    // 昨天新学的 + 昨天见过(age 3)必须压过 14 天没见的老朋友(age 30):
    // 后者再拖 8 小时不会更忘,前者会
    const yesterdayTotal = priorityScore(priorityComponents(
      row({ fsrs_stability: 0.3, last_seen_on: new Date(Date.now() - DAY).toISOString().slice(0, 10) }), undefined, 0, { randomize: false }));
    const friendTotal = priorityScore(priorityComponents(
      row({ fsrs_stability: 30, last_seen_on: new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10) }), undefined, 0, { randomize: false }));
    expect(yesterdayTotal).toBeGreaterThan(friendTotal);
    expect(yesterday.new).toBe(0);
    expect(yesterday.review).toBe(35);
  });

  it("欠了多久不再影响优先级", () => {
    const fresh = priorityComponents(row({ fsrs_stability: 5, fsrs_due: overdue(0) }), undefined, 0);
    const stale = priorityComponents(row({ fsrs_stability: 5, fsrs_due: overdue(20) }), undefined, 0);
    expect(stale.score).toBe(fresh.score);
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

  it("快速模式关闭随机抖动;普通模式抖动和陌生度同量级(整体偏规则、局部乱序)", () => {
    expect(priorityComponents(row(), 0, 0, { randomize: false }).jitter).toBe(0);
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(priorityComponents(row(), 0, 0).jitter).toBe(60);
  });
});

describe("shouldPickStage1NewWord", () => {
  it("randomly interleaves new words according to the remaining daily mix", () => {
    // 第一张必定是旧词；剩余里新词占多少就大约按多少穿插。
    expect(shouldPickStage1NewWord(200, 15, 0, 0)).toBe(false);
    expect(shouldPickStage1NewWord(20, 15, 1, 0.4)).toBe(true);
    expect(shouldPickStage1NewWord(20, 15, 1, 0.5)).toBe(false);
  });

  it("复习积压再多，新词也保底每 8 张一个", () => {
    // 200 个复习 + 15 个新词，按比例只有 7% —— 一天答四五百张也只碰得到三个新词。
    expect(shouldPickStage1NewWord(200, 15, 1, 0.1)).toBe(true);
    expect(shouldPickStage1NewWord(600, 30, 1, 0.12)).toBe(true);
    expect(shouldPickStage1NewWord(600, 30, 1, 0.13)).toBe(false);
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
