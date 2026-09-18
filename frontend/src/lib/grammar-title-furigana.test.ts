import { describe, expect, it } from "vitest";
import { grammarPoints } from "../data/grammar";
import { getGrammarTitleFurigana, getGrammarTitleFuriganaByPattern, projectFurigana } from "./grammar-title-furigana";

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

  it("数据库句型和重复句型后缀也能查到同一份注音", () => {
    expect(getGrammarTitleFuriganaByPattern("～て済む／で済む")).toEqual([
      { start: 2, length: 1, reading: "す" },
      { start: 6, length: 1, reading: "す" }
    ]);
    expect(getGrammarTitleFuriganaByPattern("～を余儀なくされる（N1-2）")).toEqual(
      getGrammarTitleFurigana("pdf-n1-196")
    );
    expect(projectFurigana(
      "基数詞（基数词）",
      "基数詞",
      getGrammarTitleFuriganaByPattern("基数詞（基数词）")
    )).toEqual([{ start: 0, length: 3, reading: "きすうし" }]);
  });
});
