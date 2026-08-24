import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { confusionGroups, duplicateWordIds, resetConfusionGroups } from "./confusion-groups";

type Row = [number, string, string, string, string, string, string];

/** id, kanji, kana, meaning, pos, verb_type, jlpt */
const seed = async (rows: Row[]) => {
  const SQL = await initSqlJs();
  testDb = new SQL.Database();
  testDb.run(`CREATE TABLE words (
    id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, meaning TEXT, pos TEXT,
    verb_type TEXT, example_jp TEXT, example_meaning TEXT, jlpt_level TEXT
  )`);
  rows.forEach(([id, kanji, kana, meaning, pos, verbType, jlpt]) => {
    testDb.run(
      "INSERT INTO words VALUES (?,?,?,?,?,?,?,?,?)",
      [id, kanji, kana, meaning, pos, verbType, `${kanji}の例文です。`, "例句", jlpt]
    );
  });
  resetConfusionGroups();
};

describe("老库里同一个词录了两遍", () => {
  beforeEach(() => { resetConfusionGroups(); });

  it("汉字假名都一样就是同一个词,和释义那栏写得一不一样无关", async () => {
    // 老库真实数据:説明|说明 和 説明|说明，解释 是同一个词录了两遍。
    // 按首义分桶会把它们分到两个桶里,于是永远碰不到面,最后成为一组「汉字用法」。
    await seed([
      [52, "説明", "せつめい", "说明", "名词", "", "N4"],
      [138, "説明", "せつめい", "说明，解释", "名词", "", "N4"]
    ]);
    expect(duplicateWordIds().size).toBe(1);
    expect(confusionGroups()).toEqual([]);
  });

  it("外来語录了三遍也认得出来(片假名行 + 英文行 + 片假名行)", async () => {
    // コピー 在老库里有三行。原来的判据要求「桶里恰好两行」,三行就整桶跳过,
    // 于是卡面上出现「コピー 和 コピー 是同音异义词」。
    await seed([
      [135, "コピー", "コピー", "复制，复印", "名词", "", ""],
      [280, "copy", "コピー", "复印；复制", "名词", "", "N5"],
      [2337, "コピー", "コピー", "copy抄本，誊本", "名·サ变", "", ""]
    ]);
    expect(duplicateWordIds().size).toBe(2);
    expect(confusionGroups()).toEqual([]);
  });

  it("真的同音异义不能被误伤", async () => {
    await seed([
      [1, "公園", "こうえん", "公园", "名词", "", "N5"],
      [2, "講演", "こうえん", "演讲", "名词", "", "N3"]
    ]);
    expect(duplicateWordIds().size).toBe(0);
    expect(confusionGroups().map((group) => group.key)).toEqual(["homophone:こうえん"]);
  });
});

describe("自他动词对", () => {
  it("搭档要汉字和假名都对上 —— 開く 有两个读音,只有 あく 是 開ける 的对子", async () => {
    await seed([
      [1, "開ける", "あける", "打开", "动词", "ichidan", "N5"],
      [2, "開く", "あく", "开着", "动词", "godan", "N4"],
      [3, "開く", "ひらく", "翻开；开设", "动词", "godan", "N3"]
    ]);
    const pair = confusionGroups().find((group) => group.type === "pair");
    expect(pair).toBeTruthy();
    // ひらく 不是自他对的成员:助词那条判据对它不成立
    expect(pair!.members.map((member) => member.kana).sort()).toEqual(["あく", "あける"]);
  });
});
