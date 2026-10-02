import { describe, expect, it } from "vitest";
import {
  classifyInput,
  compareKana,
  diagnoseReading,
  expandLongMarks,
  normalizeInput,
  splitMoras,
  toHiragana,
  toKatakana
} from "./kana";

describe("假名与输入分流", () => {
  it("NFKC、词缀符号和首尾空白归一，内部空白保留", () => {
    expect(normalizeInput("  ＡＢＣ　〜・～~  ")).toBe("ABC");
    expect(normalizeInput("  カ タ カ ナ  ")).toBe("カ タ カ ナ");
    expect(toHiragana("ｶﾞｯｺｳ".normalize("NFKC"))).toBe("がっこう");
    expect(toHiragana("ヷヸヹヺ")).toBe("ゔぁゔぃゔぇゔぉ");
    expect(toKatakana("てぃーしゃつ")).toBe("ティーシャツ");
  });

  it("按字符组成分类，并仅在非罗马音路径删除空白", () => {
    expect(classifyInput("  ")).toEqual({ form: "empty", text: "" });
    expect(classifyInput("ＡＢＣ āâ ' -")).toEqual({ form: "romaji", text: "ABC āâ ' -" });
    expect(classifyInput("kon’nichi`wa")).toEqual({ form: "romaji", text: "kon’nichi`wa" });
    expect(classifyInput("ｶﾞｯｺｳ")).toEqual({ form: "kana", text: "ガッコウ" });
    expect(classifyInput(" 食 べ る ")).toEqual({ form: "mixed", text: "食べる" });
    expect(classifyInput("東京")).toEqual({ form: "kanji", text: "東京" });
    expect(classifyInput("kaかな")).toEqual({ form: "other", text: "kaかな" });
    expect(classifyInput("かな2")).toEqual({ form: "other", text: "かな2" });
  });

  it("把拗音和外来音组合为一拍，保留原字符并拼回原文", () => {
    const kana = "ティファウィヴァシェフォデュてぃっんー";
    expect(splitMoras(kana)).toEqual(["ティ", "ファ", "ウィ", "ヴァ", "シェ", "フォ", "デュ", "てぃ", "っ", "ん", "ー"]);
    expect(splitMoras(kana).join("")).toBe(kana);
    expect(splitMoras("きゃちょぢょ")).toEqual(["きゃ", "ちょ", "ぢょ"]);
  });

  it("展开片假名长音时只借前一拍的母音", () => {
    expect(expandLongMarks("らーめん")).toBe("らあめん");
    expect(expandLongMarks("きょー")).toBe("きょお");
    expect(expandLongMarks("ーん")).toBe("ーん");
  });
});

describe("假名拼写判定", () => {
  it("读音相同也检查平假名、片假名和混写位置", () => {
    expect(compareKana("たべる", "たべる")).toEqual({ ok: true, readingOk: true, problems: [] });
    expect(compareKana("たべる", "タベル")).toEqual({ ok: false, readingOk: true, problems: [{ code: "script" }] });
    expect(compareKana("ラーメン", "らあめん")).toEqual({ ok: false, readingOk: true, problems: [{ code: "script" }] });
    expect(compareKana("ラーメン", "ラあメン")).toEqual({ ok: false, readingOk: true, problems: [{ code: "script" }] });
    expect(compareKana("てぃーシャツ", "てぃーシャツ").ok).toBe(true);
    expect(compareKana("てぃーシャツ", "てぃーしゃつ")).toEqual({ ok: false, readingOk: true, problems: [{ code: "script" }] });
  });

  it("仅当目标有 ー 时才允许用前一拍母音假名替代", () => {
    expect(compareKana("ラーメン", "ラアメン")).toEqual({ ok: true, readingOk: true, problems: [] });
    expect(compareKana("おとうさん", "おとーさん")).toMatchObject({
      ok: false, readingOk: true, problems: [{ code: "script" }, { code: "long_vowel", moraIndex: 2 }]
    });
  });

  it("保留长音、促音、拨音、读音和其它合法读音诊断", () => {
    expect(compareKana("おう", "おお")).toEqual({
      ok: false, readingOk: true, problems: [{ code: "long_vowel", moraIndex: 1 }]
    });
    expect(compareKana("がっこう", "がこう").problems).toEqual([{ code: "sokuon", moraIndex: 1 }]);
    expect(compareKana("しんぶん", "しぶん").problems).toEqual([{ code: "hatsuon", moraIndex: 1 }]);
    expect(compareKana("かた", "かち").problems).toEqual([{ code: "wrong_reading", moraIndex: 1 }]);
    expect(compareKana("あした", "あす", ["あす"])).toEqual({
      ok: false, readingOk: true, problems: [{ code: "other_reading" }]
    });
    expect(compareKana("あした", "")).toEqual({ ok: false, readingOk: false, problems: [{ code: "empty" }] });
  });

  it("按 splitMoras 位置给读音诊断", () => {
    expect(diagnoseReading("おう", "おお")).toEqual({ problem: { code: "long_vowel", moraIndex: 1 }, readingOk: true });
    expect(diagnoseReading("しんぶん", "しぶん")).toEqual({ problem: { code: "hatsuon", moraIndex: 1 }, readingOk: false });
  });
});
