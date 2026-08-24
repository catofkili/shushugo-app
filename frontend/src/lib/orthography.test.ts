import { describe, expect, it } from "vitest";
import {
  kanjiReadingPriorityAdjustment,
  kanjiReadingSurface,
  orthographyEntry,
  preferredWordSurface,
  shouldStudyKanjiReading
} from "./orthography";

describe("orthography", () => {
  it("把强假名词改成自然主表记并排除出汉字读音模式", () => {
    const word = { kanji: "殆ど", kana: "ほとんど" };
    expect(preferredWordSurface(word)).toBe("ほとんど");
    expect(shouldStudyKanjiReading(word)).toBe(false);
  });

  it("保留人工确认的片假名脚本", () => {
    expect(preferredWordSurface({ kanji: "片仮名", kana: "かたかな" })).toBe("カタカナ");
    expect(preferredWordSurface({ kanji: "海豚[いるか]", kana: "いるか" })).toBe("イルカ");
  });

  it("低优先级词经典卡用假名，但汉字模式仍可在队尾练", () => {
    const word = { kanji: "繋がる", kana: "つながる" };
    expect(orthographyEntry(word)?.band).toBe("low");
    expect(preferredWordSurface(word)).toBe("つながる");
    expect(kanjiReadingSurface(word)).toBe("繋がる");
    expect(shouldStudyKanjiReading(word)).toBe(true);
    expect(kanjiReadingPriorityAdjustment(word)).toBe(-30);
  });

  it("异体修正显示和考查标准汉字", () => {
    const word = { kanji: "嚙[か]む", kana: "かむ" };
    expect(preferredWordSurface(word)).toBe("噛む");
    expect(kanjiReadingSurface(word)).toBe("噛む");
    expect(shouldStudyKanjiReading(word)).toBe(true);
  });

  it("普通汉字保持原样，英文词源不生成汉字卡", () => {
    expect(preferredWordSurface({ kanji: "学校", kana: "がっこう" })).toBe("学校");
    expect(shouldStudyKanjiReading({ kanji: "学校", kana: "がっこう" })).toBe(true);
    expect(preferredWordSurface({ kanji: "(和) salary+man", kana: "サラリーマン" })).toBe("サラリーマン");
    expect(shouldStudyKanjiReading({ kanji: "(和) salary+man", kana: "サラリーマン" })).toBe(false);
  });
});
