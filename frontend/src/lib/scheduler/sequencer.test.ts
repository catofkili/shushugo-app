/**
 * 排片器的**序列级**断言:跑完一整场合成会话,再检查整条序列的性质。
 * 这是分层之后才写得出来的测试 —— 逐张打分的老架构没法表达「任意 12 张窗口内」。
 */
import { describe, expect, it } from "vitest";
import {
  OPENING_CARDS,
  OPENING_MIN_RECALL,
  WRONG_STREAK_TRIGGER,
  pickNextInSequence,
  type SequencerCandidate
} from "./sequencer";
import { EMPTY_INTERFERENCE, INTERFERENCE_WINDOW, type InterferenceIndex } from "./interference";

const candidate = (id: number, over: Partial<SequencerCandidate> = {}): SequencerCandidate => ({
  id,
  score: 100 - id,
  recall: 0.8,
  isLeech: false,
  ...over
});

/** 固定随机数,让「加权随机」在测试里变成确定的取第一名 */
const alwaysFirst = () => 0;

const groupsOf = (groups: number[][]): InterferenceIndex => {
  const byId = new Map<number, number>();
  groups.forEach((group, index) => group.forEach((id) => byId.set(id, index)));
  return {
    conflicts: (left, right) => byId.has(left) && byId.get(left) === byId.get(right),
    has: () => true
  };
};

const baseContext = {
  answeredToday: 50,
  recentIds: [] as number[],
  wrongStreak: 0,
  interference: EMPTY_INTERFERENCE,
  random: alwaysFirst
};

describe("排片器的单条规则", () => {
  it("同一混淆组的词不会在窗口内接着出", () => {
    const interference = groupsOf([[1, 2]]);
    const picked = pickNextInSequence(
      [candidate(2, { score: 999 }), candidate(3)],
      { ...baseContext, recentIds: [1], interference }
    );
    expect(picked?.id).toBe(3);
  });

  it("窗口滑过去之后同组词可以再出", () => {
    const interference = groupsOf([[1, 2]]);
    const stale = Array.from({ length: INTERFERENCE_WINDOW }, (_, index) => 900 + index);
    const picked = pickNextInSequence(
      [candidate(2, { score: 999 }), candidate(3)],
      { ...baseContext, recentIds: [...stale, 1], interference }
    );
    expect(picked?.id).toBe(2);
  });

  it("隔离让池子空了就放行,不会卡死", () => {
    const interference = groupsOf([[1, 2]]);
    const picked = pickNextInSequence(
      [candidate(2)],
      { ...baseContext, recentIds: [1], interference }
    );
    expect(picked?.id).toBe(2);
  });

  it("开场不给顽固词和预测最难的词", () => {
    const picked = pickNextInSequence(
      [
        candidate(1, { score: 999, isLeech: true }),
        candidate(2, { score: 998, recall: OPENING_MIN_RECALL - 0.1 }),
        candidate(3, { score: 1 })
      ],
      { ...baseContext, answeredToday: 0 }
    );
    expect(picked?.id).toBe(3);
  });

  it("开场保护只覆盖前几张", () => {
    const context = { ...baseContext, answeredToday: OPENING_CARDS };
    const picked = pickNextInSequence(
      [candidate(1, { score: 999, isLeech: true }), candidate(3, { score: 1 })],
      context
    );
    expect(picked?.id).toBe(1);
  });

  it("连着答错就避开预测最难的一半", () => {
    const picked = pickNextInSequence(
      [
        candidate(1, { score: 999, recall: 0.1 }),
        candidate(2, { score: 998, recall: 0.2 }),
        candidate(3, { score: 1, recall: 0.9 }),
        candidate(4, { score: 0, recall: 0.95 })
      ],
      { ...baseContext, wrongStreak: WRONG_STREAK_TRIGGER }
    );
    expect(picked?.recall).toBeGreaterThanOrEqual(0.9);
  });

  it("没连败时不干预,优先级说了算", () => {
    const picked = pickNextInSequence(
      [candidate(1, { score: 999, recall: 0.1 }), candidate(3, { score: 1, recall: 0.9 })],
      baseContext
    );
    expect(picked?.id).toBe(1);
  });
});

describe("整场序列的性质", () => {
  /** 跑一整场:每答完一张就把它从候选里去掉,模拟当天词逐个毕业 */
  const runSession = (
    pool: SequencerCandidate[],
    interference: InterferenceIndex,
    random: () => number
  ): number[] => {
    const remaining = [...pool];
    const order: number[] = [];
    while (remaining.length) {
      const picked = pickNextInSequence(remaining, {
        answeredToday: order.length,
        recentIds: [...order].reverse(),
        wrongStreak: 0,
        interference,
        random
      });
      if (!picked) break;
      order.push(picked.id);
      remaining.splice(remaining.findIndex((item) => item.id === picked.id), 1);
    }
    return order;
  };

  it("整场任意窗口内都不会出现同一混淆组的两个词", () => {
    // 200 个词,每 10 个一组当作互相干扰(比真实密度夸张得多)
    const groups = Array.from({ length: 20 }, (_, group) =>
      Array.from({ length: 10 }, (_, index) => group * 10 + index));
    const interference = groupsOf(groups);
    const pool = groups.flat().map((id) => candidate(id, { score: Math.random() * 100 }));

    let seed = 1;
    const order = runSession(pool, interference, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    });

    const countViolations = (sequence: number[]) => {
      let total = 0;
      for (let index = 0; index < sequence.length; index += 1) {
        for (let back = 1; back <= INTERFERENCE_WINDOW && index - back >= 0; back += 1) {
          if (interference.conflicts(sequence[index], sequence[index - back])) total += 1;
        }
      }
      return total;
    };

    expect(order).toHaveLength(pool.length);
    // 和「不做隔离」的基线对照,免得这条断言在规则失效时依然是绿的
    const baseline = countViolations(pool.map((item) => item.id));
    expect(baseline).toBeGreaterThan(order.length * 0.5);
    // 收尾阶段池子被榨干时允许让步(规则是尽力而非绝对),但绝不能是常态
    expect(countViolations(order)).toBeLessThan(order.length * 0.05);
  });

  it("开场那几张里没有顽固词", () => {
    const pool = [
      ...Array.from({ length: 20 }, (_, index) => candidate(index + 1, { score: 900 + index, isLeech: true })),
      ...Array.from({ length: 20 }, (_, index) => candidate(index + 100, { score: index }))
    ];
    const order = runSession(pool, EMPTY_INTERFERENCE, alwaysFirst);
    const opening = order.slice(0, OPENING_CARDS);
    const leechIds = new Set(pool.filter((item) => item.isLeech).map((item) => item.id));
    expect(opening.some((id) => leechIds.has(id))).toBe(false);
  });

  it("加权随机不会每次都吐同一个词,但仍偏向高优先级", () => {
    const pool = Array.from({ length: 10 }, (_, index) => candidate(index + 1, { score: 100 - index }));
    const counts = new Map<number, number>();
    for (let run = 0; run < 400; run += 1) {
      const picked = pickNextInSequence(pool, { ...baseContext, random: Math.random });
      counts.set(picked!.id, (counts.get(picked!.id) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThan(1);
    // 优先级最高的那个应当明显最常出现
    const top = counts.get(1) ?? 0;
    expect(top).toBeGreaterThan((counts.get(2) ?? 0));
    expect(top / 400).toBeGreaterThan(0.35);
  });
});
