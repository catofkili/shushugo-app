import { beforeAll, describe, expect, it } from "vitest";
import { loadPitchAccent, lookupAccent, pitchPattern, splitMorae } from "./pitch-accent";

/** 把高低画成方便读的形状:￣ 高,＿ 低,｜ 降 */
const shape = (reading: string, accent: number) =>
  pitchPattern(splitMorae(reading).length, accent)
    .map((mora) => (mora.high ? "￣" : "＿") + (mora.drop ? "｜" : ""))
    .join("");

describe("splitMorae", () => {
  it("拗音的小假名跟着前一拍,不单独成拍", () => {
    expect(splitMorae("きょう")).toEqual(["きょ", "う"]);
    expect(splitMorae("しゅっぱつ")).toEqual(["しゅ", "っ", "ぱ", "つ"]);
  });

  it("っ ん ー 各算一拍", () => {
    expect(splitMorae("にっぽん")).toEqual(["に", "っ", "ぽ", "ん"]);
    expect(splitMorae("コーヒー")).toEqual(["コ", "ー", "ヒ", "ー"]);
  });
});

describe("pitchPattern", () => {
  it("0 型(平板):第一拍低,之后一直高,不降", () => {
    expect(shape("はいざら", 0)).toBe("＿￣￣￣");
  });

  it("1 型(头高):第一拍高,之后全低,第一拍后降", () => {
    expect(shape("はし", 1)).toBe("￣｜＿");
  });

  it("2 型(尾高):第一拍低,第二拍高,第二拍后降", () => {
    expect(shape("はし", 2)).toBe("＿￣｜");
  });

  it("中高:降在词中间", () => {
    expect(shape("あなた", 2)).toBe("＿￣｜＿");
  });

  it("按拍算而不是按字算(きょ 是一拍)", () => {
    expect(shape("きょうしつ", 0)).toBe("＿￣￣￣");
  });
});

describe("lookupAccent", () => {
  beforeAll(async () => {
    await loadPitchAccent();
  });

  it("同音异义词按表记区分:箸是头高,橋是尾高", () => {
    expect(lookupAccent("箸", "はし")).toBe(1);
    expect(lookupAccent("橋", "はし")).toBe(2);
  });

  it("查得到常用词", () => {
    expect(lookupAccent("灰皿", "はいざら")).toBe(0);
    expect(lookupAccent("誠", "まこと")).toBe(0);
  });

  it("查不到返回 null,不猜", () => {
    expect(lookupAccent("架空語", "かくうご")).toBeNull();
  });
});
