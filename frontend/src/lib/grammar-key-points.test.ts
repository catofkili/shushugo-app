import { describe, expect, it } from "vitest";
import { grammarPoints } from "../data/grammar";
import data from "../data/grammar_key_points.json";
import { grammarKanjiHint, grammarKanjiHintFor, grammarKeyPoint, grammarKeyPointFor } from "./grammar-key-points";

describe("语法抓手", () => {
  it("每条语法都有抓手，且都在 20 字以内", () => {
    const missing = grammarPoints.filter((point) => !grammarKeyPointFor(point));
    expect(missing.map((point) => point.id)).toEqual([]);
    const tooLong = grammarPoints.filter((point) => [...grammarKeyPointFor(point)].length > 20);
    expect(tooLong.map((point) => point.id)).toEqual([]);
  });

  it("重名的两条各拿各的抓手，不会串成同一句", () => {
    // やる 在 N5(做，比する随便) 和 N4(给晚辈、动植物) 各有一条，
    // DB 里第二条的 pattern 是「やる（N4-2）」—— 按 title 查会把两条并成一句。
    const both = grammarPoints.filter((point) => point.title === "やる");
    expect(both).toHaveLength(2);
    const [first, second] = both.map(grammarKeyPointFor);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(grammarKeyPoint("やる（N4-2）")).toBe(second);
  });

  it("查不到的 pattern 返回空串，调用方据此不渲染", () => {
    expect(grammarKeyPoint("这个句型不存在")).toBe("");
  });
});

describe("语法汉字还原", () => {
  it("每个 pattern 都有抓手，收录数量在 30–200 之间", () => {
    expect(Object.keys(data.kanji).length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(data.kanji).length).toBeLessThanOrEqual(200);
    for (const pattern of Object.keys(data.kanji)) expect(data.points).toHaveProperty(pattern);
  });

  it("每条是三个字符串，假名是原 pattern 的连续子串", () => {
    for (const [pattern, hint] of Object.entries(data.kanji)) {
      expect(hint).toHaveLength(3);
      expect(hint.every((value) => typeof value === "string")).toBe(true);
      expect(pattern).toContain(hint[0]);
    }
  });

  it("还原片段含汉字，且这些汉字没有已经出现在题面里", () => {
    for (const [pattern, [, kanji]] of Object.entries(data.kanji)) {
      const characters = kanji.match(/\p{Script=Han}/gu);
      expect(characters).not.toBeNull();
      for (const character of characters ?? []) expect(pattern).not.toContain(character);
    }
  });

  it("中文记忆钩子不超过 22 字", () => {
    for (const [, , hook] of Object.values(data.kanji)) {
      expect(hook).toMatch(/\p{Script=Han}/u);
      expect([...hook].length).toBeLessThanOrEqual(22);
    }
  });

  it("按 pattern 返回假名、汉字和钩子，查不到就返回 null", () => {
    expect(grammarKanjiHint("～ということだ")).toEqual({
      kana: "いう", kanji: "言う", hook: data.kanji["～ということだ"][2]
    });
    expect(grammarKanjiHint("不存在的")).toBeNull();
    expect(grammarKanjiHint("～はずだ")).toBeNull();
  });

  it("详情页通过 aliases 区分同名语法，普通标题直接查", () => {
    const both = grammarPoints.filter((point) => point.title === "～こと");
    expect(both).toHaveLength(2);
    expect(both.map(grammarKanjiHintFor)).toEqual([
      grammarKanjiHint("～こと"), grammarKanjiHint("～こと（N3-2）")
    ]);
    expect(grammarKanjiHintFor(both[0])).not.toEqual(grammarKanjiHintFor(both[1]));
    expect(grammarKanjiHintFor({ id: "不存在的", title: "不存在的" })).toBeNull();
  });

  it("懒代理未加载、脏数据或稀疏数组均返回 null，不把对象交给 JSX", () => {
    const hints = data.kanji as Record<string, unknown>;
    const pattern = "__invalid_hint__";
    const proxy = new Proxy({}, { get: () => ({}) });
    try {
      for (const invalid of [proxy, undefined, null, "言う", [], ["いう", "言う"], ["いう", "言う", 1], new Array(3)]) {
        hints[pattern] = invalid;
        expect(grammarKanjiHint(pattern)).toBeNull();
      }
    } finally {
      delete hints[pattern];
    }
  });
});
