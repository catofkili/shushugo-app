import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("../database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { promptMeaning, questionMeaning } from "./word-card";
import { questionMeaningKeyOf, questionMeaningPeers, resetQuestionMeaningIndex } from "./question-meaning-index";
import { resetUserQuestionMeanings, saveUserQuestionMeaning, userQuestionMeaning } from "./user-question-meanings";

const SQL = await initSqlJs();

const seed = () => {
  const db = new SQL.Database();
  db.run(`CREATE TABLE words (id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, meaning TEXT)`);
  db.run(`CREATE TABLE word_question_meanings (
    word_id INTEGER PRIMARY KEY, prompt_meaning TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // 仿「相当」那一组（拍数也分不开，正是这个功能存在的理由）。刻意用不存在的
  // 词形和 id：真实词多半已经命中出厂的 5,853 条人工题面，那样测的是那一层。
  db.run(`INSERT INTO words (id, kanji, kana, meaning) VALUES
    (900001, '甲副', 'こうふく', '相当；很'),
    (900002, '乙副', 'おつふく', '相当；颇为'),
    (900003, '丙副', 'へいふく', '相当；很')`);
  return db;
};

describe("用户自己改写的题面", () => {
  beforeEach(() => {
    testDb = seed();
    resetUserQuestionMeanings();
    resetQuestionMeaningIndex();
  });

  it("覆盖题面，并且跳过 8 字截断", () => {
    // 原文首义都是「相当」，三个词撞在一起
    expect(promptMeaning("相当；很", 900001, "甲副", "こうふく")).toBe("相当");
    saveUserQuestionMeaning(900001, "相当（书面·程度高）");
    expect(promptMeaning("相当；很", 900001, "甲副", "こうふく")).toBe("相当（书面·程度高）");
    // 8 字截断不能把它砍成「相当（书面·程」
    expect(questionMeaning("相当；很", "甲副", "こうふく", 900001)).toBe("相当（书面·程度高）");
  });

  it("题面上显示的那行也跟着变（questionMeaning，不只是 promptMeaning）", () => {
    expect(questionMeaning("相当；很", "甲副", "こうふく", 900001)).toBe("相当；很");
    saveUserQuestionMeaning(900001, "颇·书面");
    expect(questionMeaning("相当；很", "甲副", "こうふく", 900001)).toBe("颇·书面");
  });

  it("留空 = 恢复原文，并且删掉行", () => {
    saveUserQuestionMeaning(900001, "颇·书面");
    expect(userQuestionMeaning(900001)).toBe("颇·书面");
    saveUserQuestionMeaning(900001, "   ");
    expect(userQuestionMeaning(900001)).toBeUndefined();
    expect(promptMeaning("相当；很", 900001, "甲副", "こうふく")).toBe("相当");
    const rows = testDb.exec("SELECT COUNT(*) FROM word_question_meanings")[0].values[0][0];
    expect(rows).toBe(0);
  });

  it("改完之后这个词退出撞车组（索引要作废）", () => {
    expect(questionMeaningKeyOf(900001)).toBe("相当");
    expect(questionMeaningPeers(900001).sort()).toEqual([900002, 900003]);

    saveUserQuestionMeaning(900001, "颇·书面");
    resetQuestionMeaningIndex();

    expect(questionMeaningKeyOf(900001)).toBeUndefined();
    // 剩下两个还是一组，不能被连带拆散
    expect(questionMeaningPeers(900002)).toEqual([900003]);
  });

  it("老库没有这张表时返回空而不是抛错", () => {
    testDb = new SQL.Database();
    testDb.run(`CREATE TABLE words (id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, meaning TEXT)`);
    resetUserQuestionMeanings();
    expect(() => userQuestionMeaning(900001)).not.toThrow();
    expect(userQuestionMeaning(900001)).toBeUndefined();
  });
});
