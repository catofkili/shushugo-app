import { describe, expect, it } from "vitest";
import { allocateDay, inferBudgetMinutes, type BudgetInput } from "./budget-allocator";
import type { PlanKind } from "../plan-level-order";

const kinds: PlanKind[] = ["words", "grammar", "kanji", "confusion"];
const values = <T>(value: T) => Object.fromEntries(kinds.map(k => [k, value])) as Record<PlanKind, T>;
const input = (patch: Partial<BudgetInput> = {}): BudgetInput => ({
  budgetMinutes: 20, seconds: { words: 12, grammar: 25, kanji: 10, confusion: 40 },
  mandatoryToday: values(0), dueForecast: values(Array(28).fill(0)), priorForecast: values(Array(28).fill(0)),
  need: values(8), contentLeft: values(1000), locked: {}, ...patch
});

describe("每天早上滚动分配", () => {
  it("钉住新学和复习的数，超过预算也原样输出", () => {
    const result = allocateDay(input({ budgetMinutes: 1, mandatoryToday: values(100), locked: { words: { fresh: 40, review: 100 } } }));
    expect(result.fresh.words).toBe(40);
    expect(result.reviewLimit.words).toBe(100);
    expect(result.fresh.grammar).toBe(0);
  });
  it("M0 等于或超过 B 时关闭未钉住的新学，普通复习收到 B×1.2", () => {
    for (const budgetMinutes of [10, 9]) {
      const result = allocateDay(input({ budgetMinutes, mandatoryToday: values(10) }));
      expect(result.overloaded).toBe(true);
      expect(result.fresh).toEqual(values(0));
      expect(kinds.reduce((s, k) => s + result.reviewLimit[k]! * input().seconds[k] / 60, 0)).toBeLessThanOrEqual(budgetMinutes * 1.2);
    }
    expect(allocateDay(input({ budgetMinutes: 2, mandatoryToday: { ...values(0), words: 10 } })).fresh).toEqual(values(0));
  });
  it("独立逐日卷积验证未来 28 天及今天都不超过 B，内容耗尽后不再新增", () => {
    const source = input({ mandatoryToday: values(2), contentLeft: { ...values(1000), grammar: 9 },
      dueForecast: { ...values(Array(28).fill(1)), kanji: Array.from({ length: 28 }, (_, i) => i === 20 ? 30 : 1) } });
    const result = allocateDay(source), weeks = [3, 2, 1.5, 1.5, 0.5];
    const predictions = Array.from({ length: 29 }, (_, day) => kinds.reduce((sum, k) => {
      let answers = day ? source.dueForecast[k][day - 1] + source.priorForecast[k][day - 1] : source.mandatoryToday[k];
      let remaining = source.contentLeft[k];
      for (let cohort = 0; cohort <= day; cohort++) {
        const n = Math.min(remaining, result.fresh[k]); remaining -= n;
        const age = day - cohort;
        answers += n * (age === 0 ? 1 : age < 7 ? 2 / 6 : weeks[Math.floor(age / 7)] / 7);
      }
      return sum + answers * source.seconds[k] / 60;
    }, 0));
    expect(Math.max(...predictions)).toBeCloseTo(result.peakMinutes);
    expect(predictions.every(m => m <= source.budgetMinutes)).toBe(true);
    expect(result.scale).toBeGreaterThan(0);
    expect(result.reviewLimit).toEqual(values(null));
  });
  it("x 不超过 1.5，再多时间也不超各类需要量上限", () => {
    const result = allocateDay(input({ budgetMinutes: 1000 }));
    expect(result.scale).toBe(1.5);
    expect(result.fresh).toEqual(values(12));
  });
  it("不同题型的需要量按同一个系数缩放，不能各自挑一套系数", () => {
    const source = input({ budgetMinutes: 15, need: { words: 30, grammar: 3, kanji: 8, confusion: 2 }, contentLeft: values(10000) });
    const out = allocateDay(source);
    expect(out.scale).toBeGreaterThan(0);
    expect(out.scale).toBeLessThan(1.5);
    for (const k of kinds) expect(out.fresh[k]).toBe(Math.floor(source.need[k] * out.scale));
    expect(out.peakMinutes).toBeLessThanOrEqual(15);
    expect(out.overloaded).toBe(false);
  });
  it("按昨日 ±30% 平滑，小量至少允许变两张", () => {
    expect(allocateDay(input({ budgetMinutes: 1000, need: values(30), previousFresh: values(10) })).fresh).toEqual(values(13));
    expect(allocateDay(input({ budgetMinutes: 84, need: values(30), previousFresh: values(10) })).fresh).toEqual(values(7));
    expect(allocateDay(input({ budgetMinutes: 1000, need: values(4), previousFresh: values(10) })).fresh).toEqual(values(6));
    expect(allocateDay(input({ budgetMinutes: 1000, previousFresh: values(0) })).fresh).toEqual(values(2));
    expect(allocateDay(input({ budgetMinutes: 1000, need: values(2), previousFresh: values(4) })).fresh).toEqual(values(3));
  });
  it("平滑下限不能突破预算，暂停/耗尽立即为零", () => {
    const result = allocateDay(input({ budgetMinutes: 2, previousFresh: values(30), need: { ...values(8), grammar: 0 }, contentLeft: { ...values(1000), kanji: 0 } }));
    expect(result.peakMinutes).toBeLessThanOrEqual(2);
    expect(result.fresh.grammar).toBe(0); expect(result.fresh.kanji).toBe(0);
  });
  it("某类需要为零时释放时间，其它类不超过各自需要量×1.5", () => {
    const all = allocateDay(input());
    const source = input({ need: { words: 8, grammar: 0, kanji: 0, confusion: 0 } });
    const free = allocateDay(source);
    expect(free.fresh.words).toBeGreaterThan(all.fresh.words);
    expect(free.fresh.words).toBeLessThanOrEqual(12);
    expect(free.fresh.grammar + free.fresh.kanji + free.fresh.confusion).toBe(0);
  });
  it("先验等不能裁减的量单独预留，锁定的复习不参与比例缩减", () => {
    const source = input({ budgetMinutes: 10, mandatoryToday: values(20), uncappedToday: values(2), locked: { grammar: { review: 20 } } });
    const out = allocateDay(source);
    const minutes = kinds.reduce((s, k) => s + (k === "grammar" ? 20 : out.reviewLimit[k]! + 2) * source.seconds[k] / 60, 0);
    expect(out.reviewLimit.grammar).toBe(20);
    expect(minutes).toBeLessThanOrEqual(12);
  });
  it("未来必做本身超预算时诚实报告不可行，不凭空删预测", () => {
    const out = allocateDay(input({ dueForecast: { ...values([]), words: [1000] } }));
    expect(out.overloaded).toBe(true); expect(out.scale).toBe(0); expect(out.fresh).toEqual(values(0));
  });
  it("不可裁减量本身超过B×1.2时，普通复习归零也不能删先验来伪造上限", () => {
    const source = input({ budgetMinutes: 1, mandatoryToday: values(20), uncappedToday: values(2) });
    const out = allocateDay(source);
    expect(out.overloaded).toBe(true);
    expect(out.reviewLimit).toEqual(values(0));
    expect(out.fresh).toEqual(values(0));
    expect(out.peakMinutes).toBeCloseTo(kinds.reduce((sum, k) => sum + 2 * source.seconds[k] / 60, 0));
    expect(out.peakMinutes).toBeGreaterThan(1.2);
  });
  it("第28天放行的先验也限制今天的新学，不能漏掉预测窗口末日", () => {
    const source = input({ seconds: values(60), need: { ...values(0), words: 8 } });
    expect(allocateDay(source).fresh.words).toBeGreaterThan(0);
    const out = allocateDay({ ...source, priorForecast: { ...values([]), words: Array.from({ length: 28 }, (_, i) => i === 27 ? 20 : 0) } });
    expect(out.fresh).toEqual(values(0));
    expect(out.peakMinutes).toBe(20);
    expect(out.overloaded).toBe(false);
  });
  it("今天复习未满但锁定新学让未来不可行时，保留锁定值并报告过载", () => {
    const out = allocateDay(input({ locked: { words: { fresh: 40 } } }));
    expect(out.fresh).toEqual({ ...values(0), words: 40 });
    expect(out.overloaded).toBe(true);
    expect(out.peakMinutes).toBeGreaterThan(20);
    expect(out.reviewLimit).toEqual(values(null));
  });
  it("有限内容的非单调负荷不能只靠二分：快学完能避开第28天的到期峰", () => {
    const out = allocateDay(input({ budgetMinutes: 8, seconds: values(60), need: { ...values(0), words: 10 },
      contentLeft: { ...values(0), words: 10 }, dueForecast: { ...values([]), words: Array.from({ length: 28 }, (_, i) => i === 27 ? 7 : 0) } }));
    expect(out.fresh.words).toBe(8);
    expect(out.peakMinutes).toBeLessThanOrEqual(8);
  });
  it("昨日为0时，不能把可行的8张平滑成超预算的2张，须在平滑范围内重找", () => {
    const source = input({ budgetMinutes: 8, seconds: values(60), need: { ...values(0), words: 10 },
      contentLeft: { ...values(0), words: 10 }, previousFresh: values(0),
      dueForecast: { ...values([]), words: Array.from({ length: 28 }, (_, i) => i === 27 ? 7 : 0) } });
    const out = allocateDay(source);
    expect(out.fresh.words).toBe(0); // 1、2张都在第28天超预算；也不能跳到8张突破上调限制。
    expect(out.overloaded).toBe(false);
    const remaining = source.contentLeft.words;
    for (let day = 0; day <= 28; day++) {
      let answers = day ? source.dueForecast.words[day - 1] : 0;
      for (let cohort = 0; cohort <= day; cohort++) {
        const count = Math.max(0, Math.min(out.fresh.words, remaining - cohort * out.fresh.words));
        const age = day - cohort;
        answers += count * (age === 0 ? 1 : age < 7 ? 1 / 3 : [3, 2, 1.5, 1.5, 0.5][Math.floor(age / 7)] / 7);
      }
      expect(answers, `D${day}预测分钟`).toBeLessThanOrEqual(8);
    }
    expect(out.peakMinutes).toBe(7);
  });
  it("四类有限内容和平滑组合与独立整数区间穷举一致", () => {
    for (let trial = 0; trial < 32; trial++) {
      const source = input({ budgetMinutes: 4 + trial % 7, seconds: values(60),
        need: { words: 6, grammar: 4, kanji: 3, confusion: 2 },
        contentLeft: { words: 7 + trial % 9, grammar: 3 + trial % 7, kanji: 4, confusion: 2 },
        previousFresh: values([0, 3, 8, 12][trial % 4]),
        dueForecast: { ...values([]), words: Array.from({ length: 28 }, (_, i) => i === 27 ? 3 : 0) } });
      const peak = (fresh: Record<PlanKind, number>) => {
        const minutes = [0, ...source.dueForecast.words];
        for (const k of kinds) {
          let remaining = source.contentLeft[k];
          for (let born = 0; born <= 28 && remaining > 0; born++) {
            const batch = Math.min(fresh[k], remaining); remaining -= batch;
            for (let age = 0; born + age <= 28; age++) minutes[born + age] += batch
              * (age === 0 ? 1 : age < 7 ? 1 / 3 : [3, 2, 1.5, 1.5, 0.5][Math.floor(age / 7)] / 7);
          }
        }
        return Math.max(...minutes);
      };
      const edges = [...new Set([0, 1.5, ...kinds.flatMap(k => Array.from({ length: Math.floor(source.need[k] * 1.5) }, (_, i) => (i + 1) / source.need[k]))])].sort((a, b) => b - a);
      let expected: Record<PlanKind, number> | undefined;
      for (const lowerBound of [true, false]) {
        for (const scale of edges) {
          const fresh = Object.fromEntries(kinds.map(k => {
            const previous = source.previousFresh![k], change = Math.max(2, previous * 0.3);
            const raw = Math.floor(source.need[k] * scale + 1e-9);
            return [k, Math.min(source.contentLeft[k], Math.floor(source.need[k] * 1.5), Math.floor(previous + change),
              lowerBound ? Math.max(Math.ceil(previous - change), raw) : raw)];
          })) as Record<PlanKind, number>;
          if (peak(fresh) <= source.budgetMinutes) { expected = fresh; break; }
        }
        if (expected) break;
      }
      expect(expected, `trial ${trial}必须有可行解`).toBeDefined();
      const out = allocateDay(source);
      expect(out.fresh, `trial ${trial}`).toEqual(expected);
      expect(out.peakMinutes).toBeCloseTo(peak(out.fresh));
    }
  });
});

describe("行为推断预算", () => {
  it("取近 14 个有学日中位数，一天爆量不抬预算", () => {
    const history = [999, ...Array(13).fill(20), 500, 0].map(minutes => ({ minutes, completed: false }));
    expect(inferBudgetMinutes({ history })).toBe(20);
  });
  it("最近 7 个有学日做完至少 4 天、且最近一天做完，才试探加一成", () => {
    const history = Array.from({ length: 7 }, (_, i) => ({ minutes: 20, completed: i >= 3 }));
    expect(inferBudgetMinutes({ history })).toBe(22);
    expect(inferBudgetMinutes({ history: [...history, { minutes: 20, completed: false }] })).toBe(20);
  });
  it("第二轮：做完时从昨天的 B 往上试探，不从实做中位数；B 没卡住新学就不涨", () => {
    // 实做 12 分钟 < 昨天 B 14：第一轮会得 13.2 并一路往下；现在 14×1.1。
    const history = Array.from({ length: 7 }, () => ({ minutes: 12, completed: true }));
    expect(inferBudgetMinutes({ history, previous: { B: 14, binding: true } })).toBeCloseTo(15.4);
    expect(inferBudgetMinutes({ history, previous: { B: 14, binding: false } })).toBe(14);
    // 多数天没做完：回落到实做中位数，昨天的 B 不再托底。
    const short = history.map((d, i) => ({ ...d, completed: i < 3 }));
    expect(inferBudgetMinutes({ history: short, previous: { B: 40, binding: true } })).toBe(12);
  });
  it("无历史使用计划/强度折算，均无则回退 20；显式预算优先", () => {
    expect(inferBudgetMinutes({ history: [] })).toBe(20);
    expect(inferBudgetMinutes({ history: [], fallbackMinutes: 35 })).toBe(35);
    expect(inferBudgetMinutes({ history: [{ minutes: 50, completed: true }], budgetMinutes: 15 })).toBe(15);
  });
});
