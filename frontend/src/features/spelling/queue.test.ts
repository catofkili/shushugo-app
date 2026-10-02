import { describe, expect, it, vi } from "vitest";
import type { SpellingCard } from "../../lib/spelling";
import { nextSpellingCard } from "./queue";

const card: SpellingCard = {
  wordId: 2, meaning: "吃", pos: "动词", moraCount: 3, jlptLevel: "N5", mode: "meaning",
  target: { surface: "食べる", kana: "たべる", forms: [{ surface: "食べる", tag: "standard" }], altReadings: [], isLoanword: false }
};

describe("拼写页面选卡（注入假函数，不依赖桩）", () => {
  it("空清单不查词条", () => {
    const load = vi.fn();
    expect(nextSpellingCard(() => null, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("跳过失效词，excluded 使用 card-log 的字符串 wordId", () => {
    const seen: string[][] = [];
    const pick = (_day?: string, excluded = new Set<string>()) => {
      seen.push([...excluded]);
      return [1, 2].find((id) => !excluded.has(String(id))) ?? null;
    };
    expect(nextSpellingCard(pick, (id) => id === 2 ? card : null)).toBe(card);
    expect(seen).toEqual([[], ["1"]]);
  });

  it("全部失效时返回 null，不拿失效词替代真实题面", () => {
    const pick = (_day?: string, excluded = new Set<string>()) => excluded.has("1") ? null : 1;
    expect(nextSpellingCard(pick, () => null)).toBeNull();
  });

  it("错误的选择器忽略 excluded 时停止循环并报错", () => {
    const load = vi.fn(() => null);
    expect(() => nextSpellingCard(() => 1, load)).toThrow("重复返回");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("下一轮可以再次练同一个词，不在页面端假装 FSRS 已毕业", () => {
    expect(nextSpellingCard(() => 2, () => card)).toBe(card);
    expect(nextSpellingCard(() => 2, () => card)).toBe(card);
  });

  it("数据层报错直接交给页面，不伪装成空清单", () => {
    expect(() => nextSpellingCard(() => { throw new Error("读取失败"); }, () => card)).toThrow("读取失败");
    expect(() => nextSpellingCard(() => 2, () => { throw new Error("词条失败"); })).toThrow("词条失败");
  });
});
