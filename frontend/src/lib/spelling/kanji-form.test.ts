import { describe, expect, it } from "vitest";
import { kanjiFormOf, toJapaneseForms } from "./kanji-form";

describe("kanjiFormOf", () => {
  it("优先保留日文也合法的常用汉字", () => {
    expect(kanjiFormOf("学")).toEqual({ kind: "japanese" });
    expect(kanjiFormOf("国")).toEqual({ kind: "japanese" });
  });

  it("把无歧义的简体和繁体字形映回日文", () => {
    expect(kanjiFormOf("读")).toEqual({ kind: "simplified", japanese: "読" });
    expect(kanjiFormOf("经")).toEqual({ kind: "simplified", japanese: "経" });
    expect(kanjiFormOf("經")).toEqual({ kind: "traditional", japanese: "経" });
    expect(kanjiFormOf("國")).toEqual({ kind: "traditional", japanese: "国" });
  });

  it("对多义或非汉字字符不猜", () => {
    expect(kanjiFormOf("发")).toEqual({ kind: "unknown" });
    expect(kanjiFormOf("あ")).toEqual({ kind: "unknown" });
    expect(kanjiFormOf("A")).toEqual({ kind: "unknown" });
    expect(kanjiFormOf("漢字")).toEqual({ kind: "unknown" });
  });
});

describe("toJapaneseForms", () => {
  it("逐字替换并回报 UTF-16 下标", () => {
    expect(toJapaneseForms("🙂经济經國读")).toEqual({
      text: "🙂経済経国読",
      changes: [
        { index: 2, typed: "经", expected: "経", kind: "simplified" },
        { index: 3, typed: "济", expected: "済", kind: "simplified" },
        { index: 4, typed: "經", expected: "経", kind: "traditional" },
        { index: 5, typed: "國", expected: "国", kind: "traditional" },
        { index: 6, typed: "读", expected: "読", kind: "simplified" }
      ]
    });
    expect(toJapaneseForms("漢字、かな").changes).toEqual([]);
  });
});
