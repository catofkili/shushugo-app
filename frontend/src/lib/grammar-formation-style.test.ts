import { describe, expect, it } from "vitest";
import grammarSeed from "../data/grammar_seed.json";
import { grammarPoints } from "../data/grammar";

type FormationRow = {
  source: string;
  level: string;
  pattern: string;
  formation: string;
};

const rows: FormationRow[] = [
  ...grammarPoints.flatMap((point) => [
    { source: "grammar.ts:structure", level: point.level, pattern: point.title, formation: point.structure },
    { source: "grammar.ts:connection", level: point.level, pattern: point.title, formation: point.connection ?? point.structure }
  ]),
  ...grammarSeed.rows.map((row) => ({
    source: "grammar_seed.json",
    level: String(row[8]),
    pattern: String(row[0]),
    formation: String(row[3])
  }))
];

const expectedFormation = new Map([
  ["N5:動詞「た形」", "動詞て形と同じ変化：て→た、で→だ"],
  ["N5:～から（原因）", "普通形／敬体形＋から"],
  ["N4:命令助动词「れ／ろ」", "接続 Ⅰ動詞：語尾を「え段」に変える。Ⅱ動詞：語幹＋ろ。Ⅲ動詞：（～）する→（～）しろ；来る→来い。"],
  ["N4:もし～ても", "もし＋動詞て形＋も"]
]);

describe("语法接续术语按 JLPT 等级统一", () => {
  it("N5/N4 用日式，N3–N1 用简体中文", () => {
    const violations = rows.flatMap((row) => {
      const key = row.level === "N5" || row.level === "N4" ? "日式" : "简体中文";
      const forbidden = key === "日式"
        ? /动词|名词|形容词|语干|变形规则|詞尾改成|簡体形/
        : /動詞|名詞|形容詞|語幹/;
      return forbidden.test(row.formation) ? [`${row.source} ${row.level} ${row.pattern}: ${row.formation}`] : [];
    });

    expect(violations).toEqual([]);
  });

  it("关键手动条目在两份语法源中保持同一写法", () => {
    for (const [key, formation] of expectedFormation) {
      const matchingRows = rows.filter((row) => `${row.level}:${row.pattern}` === key);
      expect(matchingRows).not.toHaveLength(0);
      expect(matchingRows.map((row) => row.formation)).toEqual(new Array(matchingRows.length).fill(formation));
    }
  });
});
