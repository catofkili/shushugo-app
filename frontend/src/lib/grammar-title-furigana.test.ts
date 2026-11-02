import { describe, expect, it } from "vitest";
import { grammarPoints } from "../data/grammar";
import { grammarQuizQuestion } from "../data/grammar-quiz-questions";
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
    expect(getGrammarTitleFuriganaByPattern("やる（N4-2）")).toEqual(
      getGrammarTitleFurigana("pdf-n4-096")
    );
    expect(projectFurigana(
      "名詞1＋は＋名詞2＋です／ではありません",
      "名詞1＋は＋名詞2＋です／ではありません",
      getGrammarTitleFuriganaByPattern("名詞1＋は＋名詞2＋です／ではありません")
    )).toEqual(getGrammarTitleFurigana("pdf-n5-001"));
  });

  it("两道读音题按 id 和 pattern 都没有标题注音，其余改写标题照常注音", () => {
    for (const id of ["pdf-n5-015", "pdf-n5-016"]) {
      const point = grammarPoints.find((point) => point.id === id)!;
      expect(getGrammarTitleFurigana(id) ?? []).toEqual([]);
      expect(getGrammarTitleFuriganaByPattern(point.title) ?? []).toEqual([]);
    }
    for (const id of ["014", "018", "019", "020", "021", "022", "029", "030", "034", "035"]) {
      expect(getGrammarTitleFurigana(`pdf-n5-${id}`)?.length).toBeGreaterThan(0);
    }
  });

  it("变形题的题面借标题注音时，只标题面里有的字，读音不能跟着标题的变形走", () => {
    for (const [pattern, readings] of [
      ["書きます・食べます・します・来ます", ["か", "た"]],
      ["書かない・買わない・食べない・しない・来ない", ["か", "か", "た"]],
      ["静かだ・静かだった・静かではない・静かではなかった", ["しず"]]
    ] as const) {
      const face = grammarQuizQuestion(pattern);
      const projected = projectFurigana(pattern, face, getGrammarTitleFuriganaByPattern(pattern)) ?? [];
      expect(projected.map((item) => item.reading)).toEqual(readings);
      expect(projected.every((item) => face.slice(item.start, item.start + item.length) !== "来")).toBe(true);
    }
  });

  it("自他动词通用标题自动注音，具体助词题不借用标题里不对应的术语读音", () => {
    const point = grammarPoints.find((point) => point.id === "pdf-n5-018")!;
    expect(point.title).toBe("～が＋自動詞／～を＋他動詞");
    expect(getGrammarTitleFurigana(point.id)).toEqual([
      { start: 3, length: 3, reading: "じどうし" },
      { start: 10, length: 3, reading: "たどうし" }
    ]);
    expect(getGrammarTitleFuriganaByPattern(point.title)).toEqual(getGrammarTitleFurigana(point.id));
    const question = grammarQuizQuestion(point.title);
    expect(question).toBe("窓（　）開く／窓（　）開ける");
    expect(projectFurigana(point.title, question, getGrammarTitleFurigana(point.id))).toEqual([]);
  });
});
