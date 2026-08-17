import { describe, expect, it } from "vitest";
import { findGrammarFormRange } from "./grammar-form-target";

describe("grammar example target", () => {
  it("从带占位符的语法标题找到例句中的实际形式", () => {
    expect(findGrammarFormRange("まあ、そこに座りたまえ。話を聞こう。", {
      title: "～たまえ",
      structure: "动词ます形＋たまえ",
      connection: "动词ます形＋たまえ"
    })).toEqual({ start: 8, end: 11, text: "たまえ" });
  });

  it("抽象接续说明没有可点击的字面形式时返回空", () => {
    expect(findGrammarFormRange("毎日、日本語を勉強します。", {
      title: "動詞「ます形」",
      structure: "動詞：う段→い段＋ます",
      connection: "動詞：う段→い段＋ます"
    })).toBeNull();
  });

  it("允许例句中的敬体活用命中语法形式", () => {
    expect(findGrammarFormRange("こちらのカードで、お支払いになれます。", {
      title: "お／ご～になれる",
      structure: "お＋动词ます形／ご＋汉语名词＋になれる",
      connection: "お＋动词ます形／ご＋汉语名词＋になれる"
    })).toEqual({ start: 13, end: 18, text: "になれます" });
  });
});
