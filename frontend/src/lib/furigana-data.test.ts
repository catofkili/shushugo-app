import { describe, expect, it } from "vitest";
import { parseFurigana, parseTokenBoundaries, tokenBoundaryAtOffset } from "./furigana-data";

describe("parseFurigana", () => {
  it("把数据库里的紧凑三元组还原成渲染对象", () => {
    expect(parseFurigana("[[0,2,\"そふぼ\"],[4,1,\"いえ\"]]")).toEqual([
      { start: 0, length: 2, reading: "そふぼ" },
      { start: 4, length: 1, reading: "いえ" }
    ]);
  });

  it("兼容人工覆盖使用的对象格式并过滤坏项", () => {
    expect(parseFurigana([
      { start: 0, length: 1, reading: "ひと" },
      { start: -1, length: 1, reading: "bad" },
      [2, 1, "いえ"]
    ])).toEqual([
      { start: 0, length: 1, reading: "ひと" },
      { start: 2, length: 1, reading: "いえ" }
    ]);
  });
});

describe("parseTokenBoundaries", () => {
  it("按 UTF-16 长度串还原 kuromoji token 边界", () => {
    const boundaries = parseTokenBoundaries("2,1,3,1,2", "祖父母は家族でした");
    expect(boundaries).toEqual([
      { start: 0, end: 2, text: "祖父", clickable: true },
      { start: 2, end: 3, text: "母", clickable: true },
      { start: 3, end: 6, text: "は家族", clickable: true },
      { start: 6, end: 7, text: "で", clickable: true },
      { start: 7, end: 9, text: "した", clickable: true }
    ]);
    expect(tokenBoundaryAtOffset(boundaries, 3)?.text).toBe("は家族");
  });

  it("拒绝和句子长度对不上的旧/坏边界", () => {
    expect(parseTokenBoundaries("2,1", "祖父母は")).toBeUndefined();
    expect(parseTokenBoundaries("2,0,1", "祖父母")).toBeUndefined();
    expect(parseTokenBoundaries("bad", "祖父母")).toBeUndefined();
  });

  it("支持负长度功能词和稀疏原形", () => {
    expect(parseTokenBoundaries("2,-1,2", "祖父は家族", '{"2":"家族"}')).toEqual([
      { start: 0, end: 2, text: "祖父", clickable: true },
      { start: 2, end: 3, text: "は", clickable: false },
      { start: 3, end: 5, text: "家族", clickable: true, lemma: "家族" }
    ]);
  });

  it("向运行时传递复合谓语词素链", () => {
    const boundaries = parseTokenBoundaries(
      "8",
      "許してもらえない",
      JSON.stringify({
        0: {
          lemma: "許す",
          morphs: [
            { surface: "許し", lemma: "許す", pos: "動詞", detail: "自立" },
            { surface: "て", lemma: "て", pos: "助詞", detail: "接続助詞" }
          ]
        }
      })
    );
    expect(boundaries?.[0].lemma).toBe("許す");
    expect(boundaries?.[0].morphs?.[1].surface).toBe("て");
  });
});
