import { describe, expect, it } from "vitest";
import { splitFormationRules } from "./grammar-formation";

describe("接续拆行", () => {
  it("两条独立规则才拆开 —— 上下各摆一条", () => {
    expect(splitFormationRules("动词ない形＋ないうちに／名词の・动词ている＋うちは")).toEqual([
      "动词ない形＋ないうちに",
      "名词の・动词ている＋うちは"
    ]);
    expect(splitFormationRules("動詞て形＋ください／動詞ない形＋ないでください")).toHaveLength(2);
  });

  it("句型自己带的 ／ 不能拆 —— 拆开就成了半句话", () => {
    // 731 条里 405 条带 ／，绝大多数是这种
    expect(splitFormationRules("名詞1＋は＋名詞2＋です／ではありません")).toEqual([
      "名詞1＋は＋名詞2＋です／ではありません"
    ]);
    expect(splitFormationRules("これ／それ／あれ／どれ＋は～")).toHaveLength(1);
  });

  it("没有接续就不占位置", () => {
    expect(splitFormationRules("")).toEqual([]);
    expect(splitFormationRules(undefined)).toEqual([]);
    expect(splitFormationRules("   ")).toEqual([]);
  });

  it("单条规则原样返回", () => {
    expect(splitFormationRules("名词の／动词ている＋間")).toEqual(["名词の／动词ている＋間"]);
  });
});
