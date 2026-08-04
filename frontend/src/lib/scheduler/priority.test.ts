import { afterEach, describe, expect, it, vi } from "vitest";
import {
  criticalPoolSize,
  pickDueCriticalPoolRow,
  pickStage1CriticalPoolRow,
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
    const components = priorityComponents(row({ seen_count: 0, shuffle_rank: 0.5, importance: 4 }), undefined, 0, 8);
    expect(components.new).toBe(45 + 8);
    expect(components.score).toBe(18);
    expect(components.shuffle).toBe(0.5 * 18);
    expect(components.importance).toBe(4 * 4);
  });

  it("越过期的词优先级越高(封顶 60,防陈年老账压过一切)", () => {
    const fresh = priorityComponents(row({ fsrs_due: overdue(1) }), undefined, 0, 0);
    const stale = priorityComponents(row({ fsrs_due: overdue(5) }), undefined, 0, 0);
    expect(stale.score).toBeGreaterThan(fresh.score);
    expect(priorityComponents(row({ fsrs_due: overdue(100) }), undefined, 0, 0).score).toBe(60);
    expect(fresh.new).toBe(0);
    expect(fresh.review).toBe(35);
  });

  it("还没到期的复习词拿不到过期加分", () => {
    const future = new Date(Date.now() + 10 * DAY).toISOString();
    expect(priorityComponents(row({ fsrs_due: future }), undefined, 0, 0).score).toBe(0);
  });

  it("学习/重学中的词排在「已见但没进过调度」之上——治『点了不认识就再也不回来』", () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();  // 十分钟后
    const relearning = priorityComponents(row({ fsrs_state: 3, fsrs_due: future }), undefined, 0, 0);
    const unscheduled = priorityComponents(row({ fsrs_due: null }), undefined, 0, 0);
    expect(relearning.score).toBeGreaterThan(unscheduled.score);
    expect(unscheduled.score).toBeGreaterThan(0);
  });

  it("错误史用 FSRS 的 lapses,不再叠加三个旧计数", () => {
    expect(priorityComponents(row({ fsrs_lapses: 3 }), undefined, 0, 0).mistake).toBe(30);
    expect(priorityComponents(row({ fsrs_lapses: 0 }), undefined, 0, 0).mistake).toBe(0);
  });

  it("顽固词(lapses >= 8)加权,池子越挤加得越狠", () => {
    const base = priorityComponents(row({ fsrs_lapses: 8 }), undefined, 0, 0);
    expect(base.critical).toBe(120);
    const crowded = priorityComponents(row({ fsrs_lapses: 8 }), undefined, 6, 0);
    expect(crowded.critical).toBe(120 + 3 * 80);
  });

  it("顽固词池挤的时候压制普通词", () => {
    const components = priorityComponents(row({ fsrs_lapses: 0 }), undefined, 4, 0);
    expect(components.critical).toBe(-1000);
  });

  it("promotes due queue entries and buries not-yet-due ones", () => {
    expect(priorityComponents(row(), 0, 0, 0).queue).toBe(45);
    expect(priorityComponents(row(), 2, 0, 0).queue).toBe(-80 - 2 * 25);
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

describe("criticalPoolSize", () => {
  it("clamps the pool between 3 and 5", () => {
    expect(criticalPoolSize(1)).toBe(3);
    expect(criticalPoolSize(4)).toBe(4);
    expect(criticalPoolSize(9)).toBe(5);
  });
});

describe("pickStage1CriticalPoolRow", () => {
  const critical = (id: number, lapses: number, extra: DbRow = {}): DbRow => (
    row({ id, fsrs_lapses: lapses, today_seen_count: 0, order_index: id, ...extra })
  );

  it("没有顽固词(lapses < 8)时不开池", () => {
    const rows = [critical(1, 2), critical(2, 7)];
    expect(pickStage1CriticalPoolRow(rows, new Map())).toBeNull();
  });

  it("池里优先挑已经隔够张数的", () => {
    const rows = [critical(1, 12), critical(2, 9), critical(3, 8)];
    const queue = new Map<number, number>([[1, 2], [2, 0], [3, 5]]);
    expect(pickStage1CriticalPoolRow(rows, queue)?.id).toBe(2);
  });

  it("池里没人到位就交还给普通优先级,不把刚答过的词顶回来", () => {
    const rows = [critical(1, 12), critical(2, 9)];
    const queue = new Map<number, number>([[1, 3], [2, 1]]);
    expect(pickStage1CriticalPoolRow(rows, queue)).toBeNull();
  });

  it("只收 lapses 达到阈值的行,错得最多的排最前", () => {
    const rows = [critical(1, 12), critical(2, 1)];
    const picked = pickStage1CriticalPoolRow(rows, new Map());
    expect(picked?.id).toBe(1);
  });
});

describe("pickDueCriticalPoolRow", () => {
  it("returns null without a floor word", () => {
    expect(pickDueCriticalPoolRow([row({ score: -25 })])).toBeNull();
  });

  it("picks the least-seen due critical word", () => {
    const rows = [
      row({ id: 1, score: -45, today_seen_count: 3, due_after: 0 }),
      row({ id: 2, score: -22, today_seen_count: 1, due_after: 0 }),
      row({ id: 3, score: -21, today_seen_count: 0, due_after: 2 })
    ];
    expect(pickDueCriticalPoolRow(rows)?.id).toBe(2);
  });

  it("stands down when every critical word is still waiting its gap out", () => {
    const rows = [
      row({ id: 1, score: -45, due_after: 2 }),
      row({ id: 2, score: -22, due_after: 1 })
    ];
    expect(pickDueCriticalPoolRow(rows)).toBeNull();
  });

  it("supports alternate score columns", () => {
    const rows = [
      row({ id: 1, kanji_score: -50, due_after: 0 }),
      row({ id: 2, kanji_score: -20, due_after: 0, today_seen_count: 0 })
    ];
    const picked = pickDueCriticalPoolRow(rows, "kanji_score");
    expect(picked).not.toBeNull();
  });
});
