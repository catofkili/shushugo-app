import { describe, expect, it } from "vitest";
import { patternAttachment, patternPieces, splitFormationRules } from "./grammar-formation";

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

describe("接续标到题面 `～` 头上", () => {
  it("题面按 `～` 切块，UI 照这个顺序渲染", () => {
    expect(patternPieces("～にしろ～にせよ")).toEqual([
      { text: "～", slot: true },
      { text: "にしろ", slot: false },
      { text: "～", slot: true },
      { text: "にせよ", slot: false }
    ]);
    expect(patternPieces("もう～")).toEqual([
      { text: "もう", slot: false },
      { text: "～", slot: true }
    ]);
  });

  it("取 ＋ 前面那一段", () => {
    expect(patternAttachment("～たばかり", "動詞た形＋ばかり")).toBe("動詞た形");
    expect(patternAttachment("～間に（あいだに）", "名词の／动词ている＋間に")).toBe("名词の／动词ている");
  });

  it("叠用句型每个 `～` 都标同一段 —— 这正是它该有的样子", () => {
    expect(patternAttachment(
      "～にしろ～にしろ／～にせよ～にせよ",
      "名词／用言普通形＋にしろ／にせよ（叠用）"
    )).toBe("名词／用言普通形");
  });

  it("两条独立规则各取一段并起来，不能只说一半", () => {
    expect(patternAttachment(
      "～てください／ないでください",
      "動詞て形＋ください／動詞ない形＋ないでください"
    )).toBe("動詞て形／動詞ない形");
  });

  it("⚠️ 头一段本来就是句型的一部分时不标 —— 标了就成了「往 `～` 里填 お」", () => {
    expect(patternAttachment("お／ご～になる", "お＋動詞ます形＋になる")).toBeNull();
    expect(patternAttachment("もう～", "もう＋た形／もう＋～ない")).toBeNull();
    expect(patternAttachment("なにしろ～から", "なにしろ＋句子＋から")).toBeNull();
    expect(patternAttachment("ちっとも～ない", "ちっとも＋否定")).toBeNull();
  });

  it("⚠️ 多个 `～` 填的不是一个东西时一律不标，比标错强", () => {
    expect(patternAttachment("～から～にかけて", "名词＋から＋名词＋にかけて")).toBeNull();
    expect(patternAttachment("～ば～ほど", "用言ば形＋同一用言辞書形（ナ形容词な）＋ほど")).toBeNull();
    expect(patternAttachment("～と～とどちらが～か", "名詞と名詞とどちらが＋形容詞＋か")).toBeNull();
  });

  it("形状不对的一概不标，答案区那行完整接续照旧", () => {
    // 没有 ＋：整句说明，不是「A ＋ 句型」
    expect(patternAttachment("～ば", "ば形：動詞仮定形／い形容詞ければ")).toBeNull();
    // 头一段自己还含 `～`：说的是助词不是接续
    expect(patternAttachment("～てある", "～が／は＋他動詞て形＋ある")).toBeNull();
    // 题面根本没有 `～`
    expect(patternAttachment("な形容詞＋名詞", "語幹＋な＋名詞")).toBeNull();
    expect(patternAttachment("", "")).toBeNull();
  });
});
