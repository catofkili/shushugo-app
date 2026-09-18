import { describe, expect, it } from "vitest";
// 例句合成脚本的纯函数部分:振假名怎么展开成拍、助词在哪一拍、明确假名记法怎么写。
// @ts-expect-error 脚本是 .mjs,没有类型
import { intendedReading, kanaSubstituted, pronunciationMismatch, explicitKanaNotation } from "../../scripts/voicevox-reading.mjs";

const item = (text: string, furigana: [number, number, string][]) => ({ text, furigana });
const mora = (text: string, vowel = "a") => ({ text, vowel });

describe("intendedReading", () => {
  it("展开振假名,跳过标点,拗音并拍", () => {
    const r = intendedReading(item("駅で友達を待ちました。", [[0, 1, "えき"], [2, 2, "ともだち"], [5, 1, "ま"]]));
    expect(r.morae.join("")).toBe("エキデトモダチヲマチマシタ");
  });
  it("只有原文平假名的 は/へ 才算助词;汉字读出来的 ハ 不算", () => {
    const r = intendedReading(item("母は家へ帰る", [[0, 1, "はは"], [2, 1, "いえ"], [4, 1, "かえ"]]));
    expect(r.morae.join("")).toBe("ハハハイエヘカエル");
    expect([...r.particles]).toEqual([2, 5]); // ハ ハ [ハ] イ エ [ヘ] カ エ ル
  });
  it("振假名盖不住的字(简体字、数字)校不了 → null", () => {
    expect(intendedReading(item("公园へ行く", [[2, 1, "い"]]))).toBeNull();
    expect(intendedReading(item("3人で", [[1, 1, "にん"]]))).toBeNull();
  });
  it("kanaSubstituted 把汉字换成振假名", () => {
    expect(kanaSubstituted(item("駅で待つ", [[0, 1, "えき"], [2, 1, "ま"]]))).toBe("えきでまつ");
  });
});

describe("pronunciationMismatch / explicitKanaNotation(例句)", () => {
  const query = {
    accent_phrases: [
      { moras: [mora("ハ"), mora("ハ"), mora("ワ")], accent: 1, pause_mora: { text: "、" } },
      { moras: [mora("イ", "i"), mora("エ", "e"), mora("エ", "e")], accent: 2 },
      { moras: [mora("カ"), mora("エ", "e"), mora("ル", "u")], accent: 1, is_interrogative: true }
    ]
  };
  const intended = intendedReading(item("母は、家へ帰る", [[0, 1, "はは"], [3, 1, "いえ"], [5, 1, "かえ"]]));
  it("助词位的 ワ/エ 放行,汉字位不放", () => {
    expect(pronunciationMismatch(query, intended.morae, intended.particles)).toBeNull();
    expect(pronunciationMismatch(query, intended.morae, new Set())).toMatch(/第 3 拍/);
  });
  it("记法:停顿处写 、,其余 /,疑问句尾 ？", () => {
    expect(explicitKanaNotation(query, null, intended.morae, intended.particles)).toBe("ハ'ハワ、イエ'エ/カ'エル？");
  });
});
