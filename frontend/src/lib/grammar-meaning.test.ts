import { describe, expect, it } from "vitest";
import { grammarPoints } from "../data/grammar";
import { meaningSummary, parseMeaning } from "./grammar-meaning";

describe("语法中文意里的表格", () => {
  it("含「｜」的相邻行合成一张表，其余行是段落", () => {
    expect(parseMeaning("先说明：\n形式｜意思\n二つ目｜第二个\n补一句。")).toEqual([
      { text: "先说明：" },
      { rows: [["形式", "意思"], ["二つ目", "第二个"]] },
      { text: "补一句。" }
    ]);
  });

  it("没有表格的中文意原样一段", () => {
    expect(parseMeaning("做……")).toEqual([{ text: "做……" }]);
    expect(meaningSummary("做……")).toBe("做……");
  });

  it("单行位置只取第一行", () => {
    expect(meaningSummary("静か（安静）的敬体：\n｜肯定｜否定")).toBe("静か（安静）的敬体：");
  });

  it("全库的表格每行都不超过表头的列数，也没有空表头", () => {
    for (const point of grammarPoints) {
      for (const block of parseMeaning(point.meaning)) {
        if (!("rows" in block)) continue;
        const [header, ...body] = block.rows;
        expect(header.length, point.id).toBeGreaterThanOrEqual(2);
        for (const row of body) expect(row.length, `${point.id} ${row.join("｜")}`).toBeLessThanOrEqual(header.length);
      }
    }
  });
});
