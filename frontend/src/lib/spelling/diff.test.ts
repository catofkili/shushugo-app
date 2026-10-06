import { describe, expect, it } from "vitest";
import { markDifferences } from "./diff";
import type { SpellingTarget } from "./types";

const target = (surface: string, kana: string, extra: Partial<SpellingTarget> = {}): SpellingTarget => ({
  kana, surface, forms: surface === kana ? [] : [{ surface, tag: "standard" }], altReadings: [], isLoanword: false, ...extra
});
const text = (parts: { text: string }[]) => parts.map((part) => part.text).join("");
const wrongOf = (parts: { text: string; wrong: boolean }[]) => parts.filter((part) => part.wrong).map((part) => part.text).join("");

describe("只标出和答案不一样的字", () => {
  it("没写东西没有对照", () => {
    expect(markDifferences(target("食べる", "たべる"), "  ", false)).toBeNull();
  });

  it("写对了（引擎认可）一个字都不标，答案那行留空由界面直接显示原答案", () => {
    const diff = markDifferences(target("食べる", "たべる"), "shi", true)!;
    expect(diff.typed).toEqual([{ text: "shi", wrong: false }]);
    expect(diff.answer).toEqual([]);
  });

  it("汉字写法：错的字标红，两边都标（写错的、漏掉的）", () => {
    const diff = markDifferences(target("食べ物", "たべもの"), "食べ者", false)!;
    expect(diff.against).toBe("surface");
    expect(wrongOf(diff.typed)).toBe("者");
    expect(wrongOf(diff.answer)).toBe("物");
    expect(text(diff.typed)).toBe("食べ者");
  });

  it("交ぜ書き：被换成假名的汉字标红，答案那一行标出该写的字", () => {
    const diff = markDifferences(target("食べ物", "たべもの"), "たべ物", false)!;
    expect(wrongOf(diff.typed)).toBe("た");
    expect(wrongOf(diff.answer)).toBe("食");
  });

  it("简体字形：字标红", () => {
    const diff = markDifferences(target("運動", "うんどう"), "运動", false)!;
    expect(wrongOf(diff.typed)).toBe("运");
    expect(wrongOf(diff.answer)).toBe("運");
  });

  it("多个被接受的写法：和重合最多的那条比", () => {
    const diff = markDifferences(target("行う", "おこなう", { forms: [{ surface: "行う", tag: "standard" }, { surface: "行なう", tag: "variant" }] }), "行なた", false)!;
    expect(diff.answer.map((part) => part.text).join("")).toBe("行なう");
    expect(wrongOf(diff.typed)).toBe("た");
  });

  it("假名：对照读音，漏写和写错都标", () => {
    const diff = markDifferences(target("食べる", "たべる"), "たびる", false)!;
    expect(diff.against).toBe("kana");
    expect(wrongOf(diff.typed)).toBe("び");
    expect(wrongOf(diff.answer)).toBe("べ");
  });

  it("平 / 片假名用错：整个词都是红的", () => {
    const diff = markDifferences(target("カメラ", "カメラ", { isLoanword: true }), "かめら", false)!;
    expect(wrongOf(diff.typed)).toBe("かめら");
    expect(wrongOf(diff.answer)).toBe("カメラ");
  });

  it("罗马音：对照罗马音，大小写、空格、撇号不算差别；长音符展开成双写", () => {
    const diff = markDifferences(target("東京", "とうきょう"), "To u Kyo", false)!;
    expect(diff.against).toBe("romaji");
    expect(wrongOf(diff.typed)).toBe("");
    expect(wrongOf(diff.answer)).toBe("u");
    expect(text(diff.answer)).toBe("toukyou");
    const long = markDifferences(target("カード", "カード"), "kaadu", false)!;
    expect(text(long.answer)).toBe("kaado");
    expect(wrongOf(long.typed)).toBe("u");
  });

  it("另一个合法读音也能当对照", () => {
    const diff = markDifferences(target("明日", "あした", { altReadings: ["あす"] }), "あず", false)!;
    expect(text(diff.answer)).toBe("あす");
    expect(wrongOf(diff.typed)).toBe("ず");
  });

  it("全角、半角先统一，内部空白不算", () => {
    const diff = markDifferences(target("食べる", "たべる"), "ＴＡＢＥＲＵ", false)!;
    expect(text(diff.typed)).toBe("taberu");
    expect(wrongOf(diff.typed)).toBe("");
  });

  it("很长的输入不会卡住（上限 200 字）", () => {
    const diff = markDifferences(target("食べる", "たべる"), "あ".repeat(5000), false)!;
    expect(text(diff.typed).length).toBeLessThanOrEqual(200);
  });
});
