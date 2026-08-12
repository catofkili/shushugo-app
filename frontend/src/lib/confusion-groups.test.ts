import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { confusionGroups, resetConfusionGroups, type ConfusionGroup } from "./confusion-groups";

const findGroup = (groups: ConfusionGroup[], key: string) => groups.find((group) => group.key === key);

describe("疑难辨析分组", () => {
  let groups: ConfusionGroup[];

  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
    groups = confusionGroups();
  });

  it("六类都分得出来,组数在合理量级", () => {
    const byType = new Map<string, number>();
    groups.forEach((group) => byType.set(group.type, (byType.get(group.type) ?? 0) + 1));
    // 每一类都必须有货 —— 少了任何一类都说明判据写错了
    ["pair", "homophone", "kanji-choice", "reading-register", "reading-sense", "stem", "synonym"]
      .forEach((type) => expect(byType.get(type) ?? 0).toBeGreaterThan(0));
    expect(groups.length).toBeGreaterThan(500);
  });

  it("同音异义按假名成组,首义必须互不相同", () => {
    const group = findGroup(groups, "homophone:こうえん");
    expect(group).toBeTruthy();
    const forms = group!.members.map((member) => member.kanji);
    expect(forms).toContain("公園");
    expect(forms).toContain("講演");
  });

  it("同表記異読み按汉字成组 —— 这类假名不同,按假名分的组抓不到", () => {
    const group = findGroup(groups, "reading-register:明後日");
    expect(group).toBeTruthy();
    expect(group!.members.map((member) => member.kana).sort()).toEqual(["あさって", "みょうごにち"]);
  });

  it("纯异写不算易混词,不进分组", () => {
    // 繋がる / つながる 读音相同、意思相同、只是一个写汉字一个不写 —— 同一个词的
    // 两种写法,收进来只会让用户去找不存在的区别。
    //
    // 判据必须是「同假名 + 同首义 + 有一方没汉字」三条同时成立。只看「有一方没
    // 汉字」会误伤 文化/カルチャー、牛乳/ミルク 这种和語 vs 外来語的对子 ——
    // 那是真的语种差异,正是要教的东西。
    const firstSense = (text: string) => text.split(/[；;，,、]/)[0].trim();
    const variants = groups.filter((group) => group.members.some((left) =>
      group.members.some((right) => right.id !== left.id
        && right.kana === left.kana
        && firstSense(right.meaning) === firstSense(left.meaning)
        && !/[㐀-鿿]/.test(right.kanji))));
    expect(variants).toHaveLength(0);
  });

  it("和語 vs 外来語的对子要留着 —— 那是语种差异,不是异写", () => {
    const group = findGroup(groups, "synonym:牛奶");
    expect(group?.members.map((member) => member.kana).sort()).toEqual(["ぎゅうにゅう", "ミルク"]);
  });

  it("组内成员不超过上限 —— 超了说明分组滚了雪球", () => {
    groups.forEach((group) => {
      expect(group.members.length).toBeGreaterThanOrEqual(2);
      expect(group.members.length).toBeLessThanOrEqual(8);
    });
  });

  it("key 用词形不用 word_id —— id 被去重和外来語合并动过", () => {
    groups.forEach((group) => {
      expect(group.key).toBe(`${group.type}:${group.label}`);
      expect(group.key).not.toMatch(/:\d+$/);
    });
    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length);
  });

  it("老用户库里没合并的外来語重复行不能当成同音异义", () => {
    // 用户真实截图里出现过「同音异义 スピーチ / スピーチ」—— 自己跟自己辨析。
    // 出厂库 bake 已经合并了这类行,但**老用户的库不会**(那次去重刻意没做迁移,
    // 删行会连带删掉挂在上面的学习记录),所以分组本身必须扛得住。
    //
    // 关键点:老库里英文行的释义是「speech讲话，演说，致词」,英文原词粘在中文
    // 前面,首义和片假名行的「演讲」对不上 —— 靠「首义相同」判是拦不住的。
    testDb.run(`
      INSERT INTO words (id, kanji, kana, meaning, pos, jlpt_level) VALUES
        (900001, 'speech', 'スピーチテスト', 'speech讲话，演说，致词', '名词', NULL),
        (900002, 'スピーチテスト', 'スピーチテスト', '演讲', '名词', 'N3')
    `);
    resetConfusionGroups();
    expect(findGroup(confusionGroups(), "homophone:スピーチテスト")).toBeUndefined();

    testDb.run("DELETE FROM words WHERE id IN (900001, 900002)");
    resetConfusionGroups();
  });

  it("真正的同音外来語要留着 —— 两行都是英文原词,不是同一个词录两遍", () => {
    testDb.run(`
      INSERT INTO words (id, kanji, kana, meaning, pos, jlpt_level) VALUES
        (900002, 'lock', 'ロツク', '锁', '名词', NULL),
        (900003, 'rock', 'ロツク', '摇滚', '名词', NULL)
    `);
    resetConfusionGroups();
    const group = findGroup(confusionGroups(), "homophone:ロツク");
    expect(group?.members.map((member) => member.kanji).sort()).toEqual(["lock", "rock"]);

    testDb.run("DELETE FROM words WHERE id IN (900002, 900003)");
    resetConfusionGroups();
  });
});
