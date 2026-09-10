import { describe, expect, it } from "vitest";
import { grammarPoints } from "../data/grammar";
import { grammarKeyPoint, grammarKeyPointFor } from "./grammar-key-points";

describe("语法抓手", () => {
  it("741 条一条不缺，且都在 20 字以内", () => {
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
