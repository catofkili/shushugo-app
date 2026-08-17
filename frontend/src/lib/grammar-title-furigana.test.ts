import { describe, expect, it } from "vitest";
import { grammarPoints } from "../data/grammar";
import { getGrammarTitleFurigana } from "./grammar-title-furigana";

describe("grammar title furigana", () => {
  it("为语法主页面的标题提供构建期注音", () => {
    expect(getGrammarTitleFurigana("pdf-n3-005")).toEqual([
      { start: 1, length: 2, reading: "いっぽう" }
    ]);
    expect(getGrammarTitleFurigana("pdf-n3-008")).toEqual([
      { start: 1, length: 1, reading: "うえ" },
      { start: 7, length: 1, reading: "うえ" }
    ]);
  });

  it("所有生成区间都落在对应标题的汉字上", () => {
    for (const point of grammarPoints) {
      for (const annotation of getGrammarTitleFurigana(point.id) ?? []) {
        const end = annotation.start + annotation.length;
        expect(end).toBeLessThanOrEqual(point.title.length);
        expect(point.title.slice(annotation.start, end)).toMatch(/[\u3400-\u9fff々〇]/u);
      }
    }
  });
});
