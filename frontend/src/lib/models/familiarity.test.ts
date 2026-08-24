import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("../database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { confusionCandidates, resetConfusionCache } from "./confusion";
import { resetConfusionGroups } from "../confusion-groups";
import { resetFamiliarityCache } from "./familiarity";

const N5_CARD = [1, "安心", "あんしん", "安心的", "N5"] as const;

const seed = async (extra: (readonly [number, string, string, string, string])[], studied: number[] = []) => {
  const SQL = await initSqlJs();
  testDb = new SQL.Database();
  testDb.run(`CREATE TABLE words (
    id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, meaning TEXT, pos TEXT,
    verb_type TEXT, example_jp TEXT, example_meaning TEXT, jlpt_level TEXT, importance INTEGER
  )`);
  testDb.run("CREATE TABLE progress (word_id INTEGER PRIMARY KEY, fsrs_due TEXT, fsrs_last_review TEXT)");
  [N5_CARD, ...extra].forEach(([id, kanji, kana, meaning, jlpt]) => {
    testDb.run("INSERT INTO words VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, kanji, kana, meaning, "名词", "", "", "", jlpt, 0]);
  });
  studied.forEach((id) => testDb.run("INSERT INTO progress VALUES (?, ?, ?)", [id, "2026-08-21", "2026-08-20"]));
  resetConfusionCache();
  resetConfusionGroups();
  resetFamiliarityCache();
};

const soundOf = () => {
  const row = { id: 1, kanji: "安心", kana: "あんしん", meaning: "安心的", pos: "名词", jlpt_level: "N5" };
  return confusionCandidates(row).filter((item) => item.kind === "sound").map((item) => item.kanji);
};

describe("拿来当易混词的门槛", () => {
  beforeEach(() => { resetFamiliarityCache(); });

  it("没学过又比这张难的词不摆出来 —— 学 安心(N5) 的时候提 暗然(N1) 是噪音", async () => {
    await seed([[2, "暗然", "あんぜん", "黯然的", "N1"]]);
    expect(soundOf()).toEqual([]);
  });

  it("学过就算数,级别再高也摆", async () => {
    await seed([[2, "暗然", "あんぜん", "黯然的", "N1"]], [2]);
    expect(soundOf()).toEqual(["暗然"]);
  });

  it("不比这张难的一律摆 —— 新用户 progress 是空的,不能让他一条易混词都看不到", async () => {
    await seed([[2, "感心", "かんしん", "令人佩服的", "N5"]]);
    expect(soundOf()).toEqual(["感心"]);
  });

  it("「无级」是用户自己导的词表,按中间档算,不当生僻词", async () => {
    await seed([[2, "安全", "あんぜん", "安全的", ""]]);
    expect(soundOf()).toEqual([]);          // N5 的卡够不着中间档
    await seed([[2, "安全", "あんぜん", "安全的", ""]], [2]);
    expect(soundOf()).toEqual(["安全"]);    // 学过就摆
  });
});
