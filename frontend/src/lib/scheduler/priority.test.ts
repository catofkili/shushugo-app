import { afterEach, describe, expect, it, vi } from "vitest";
import {
  criticalPoolSize,
  pickDueCriticalPoolRow,
  pickStage1CriticalPoolRow,
  priorityComponents,
  priorityScore
} from "./priority";
import type { DbRow } from "../database/db-utils";

const row = (overrides: DbRow = {}): DbRow => ({
  id: 1,
  seen_count: 1,
  score: 0,
  importance: 3,
  forgot_count: 0,
  fuzzy_count: 0,
  mistake_streak: 0,
  right_count: 0,
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

  it("scores seen words by distance to mastery", () => {
    const components = priorityComponents(row({ score: -10 }), undefined, 0, 0);
    expect(components.score).toBe((10 - -10) * 5);
    expect(components.new).toBe(0);
  });

  it("never lets mastered words earn score priority", () => {
    const components = priorityComponents(row({ score: 15 }), undefined, 0, 0);
    expect(components.score).toBe(0);
  });

  it("weights mistakes above right answers", () => {
    const components = priorityComponents(
      row({ forgot_count: 2, fuzzy_count: 1, mistake_streak: 1, right_count: 3 }),
      undefined,
      0,
      0
    );
    expect(components.mistake).toBe(2 * 14 + 1 * 7 + 1 * 12 - 3 * 3);
  });

  it("boosts critical words and escalates with pool pressure", () => {
    const base = priorityComponents(row({ score: -20 }), undefined, 0, 0);
    expect(base.critical).toBe(120);
    const crowded = priorityComponents(row({ score: -20 }), undefined, 6, 0);
    expect(crowded.critical).toBe(120 + 3 * 80);
  });

  it("suppresses non-critical words when the critical pool is crowded", () => {
    const components = priorityComponents(row({ score: 0 }), undefined, 4, 0);
    expect(components.critical).toBe(-1000);
  });

  it("promotes due queue entries and buries not-yet-due ones", () => {
    expect(priorityComponents(row(), 0, 0, 0).queue).toBe(45);
    expect(priorityComponents(row(), 2, 0, 0).queue).toBe(-80 - 2 * 25);
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
  const critical = (id: number, score: number, extra: DbRow = {}): DbRow => (
    row({ id, score, today_seen_count: 0, order_index: id, ...extra })
  );

  it("stays inactive until some word hits the -40 floor", () => {
    const rows = [critical(1, -25), critical(2, -30)];
    expect(pickStage1CriticalPoolRow(rows, new Map())).toBeNull();
  });

  it("prefers due words inside the pool", () => {
    const rows = [critical(1, -45), critical(2, -30), critical(3, -25)];
    const queue = new Map<number, number>([[1, 2], [2, 0], [3, 5]]);
    expect(pickStage1CriticalPoolRow(rows, queue)?.id).toBe(2);
  });

  it("falls back to the least-recently-queued word when none is due", () => {
    const rows = [critical(1, -45), critical(2, -30)];
    const queue = new Map<number, number>([[1, 3], [2, 1]]);
    expect(pickStage1CriticalPoolRow(rows, queue)?.id).toBe(2);
  });

  it("ignores rows above the critical threshold", () => {
    const rows = [critical(1, -45), critical(2, -5)];
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

  it("supports alternate score columns", () => {
    const rows = [
      row({ id: 1, kanji_score: -50, due_after: 0 }),
      row({ id: 2, kanji_score: -20, due_after: 0, today_seen_count: 0 })
    ];
    const picked = pickDueCriticalPoolRow(rows, "kanji_score");
    expect(picked).not.toBeNull();
  });
});
