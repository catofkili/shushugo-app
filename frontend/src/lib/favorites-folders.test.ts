import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({ getDatabase: () => testDb }));
vi.mock("./storage", () => ({
  scheduleSave: () => undefined,
  saveRecoverySnapshot: async () => "test-recovery"
}));

import { studyDate } from "./database/db-utils";
import {
  addFavorite,
  createFavoriteFolder,
  deleteFavoriteFolder,
  getFavoriteItems,
  listFavoriteFolders,
  renameFavoriteFolder,
  toggleFavorite,
  unfiledFavoriteCount
} from "./favorites-api";
import { getStubbornWordsToday } from "./word-api/stubborn-today";
import { STUBBORN_DAILY_MISTAKES } from "./fsrs-scheduler";

/** 和 stubborn-today 里的 STUBBORN_TOTAL_FORGOTS 同一个数（那边没导出，钉在这里）。 */
const TOTAL_FORGOTS = 8;

const one = (sql: string, params: Array<string | number> = []) => (
  testDb.exec(sql, params)[0]?.values[0]?.[0]
);

beforeEach(async () => {
  const SQL = await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(
    fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
  )));
  testDb.run(`CREATE TABLE IF NOT EXISTS content_favorites (
    item_type TEXT NOT NULL, item_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    folder TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (item_type, item_id)
  )`);
  testDb.run(`CREATE TABLE IF NOT EXISTS favorite_folders (
    name TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  testDb.run("DELETE FROM content_favorites");
  testDb.run("DELETE FROM favorite_folders");
});

describe("收藏夹", () => {
  it("收进夹子后按夹子取得出来，夹名就是行身份", () => {
    const name = createFavoriteFolder("  考前突击  ");
    expect(name).toBe("考前突击");

    addFavorite("word", 1, name);
    addFavorite("word", 2);

    expect(getFavoriteItems("word", name).map((item) => item.id)).toEqual(["1"]);
    expect(unfiledFavoriteCount()).toBe(1);
    expect(listFavoriteFolders()).toEqual([{ name: "考前突击", count: 1 }]);
  });

  it("已收藏的词再点一次只换夹子，不会被当成取消收藏", () => {
    const name = createFavoriteFolder("动词");
    addFavorite("word", 1);
    addFavorite("word", 1, name);

    expect(Number(one("SELECT COUNT(*) FROM content_favorites"))).toBe(1);
    expect(getFavoriteItems("word", name).map((item) => item.id)).toEqual(["1"]);
  });

  it("改名带着里面的收藏一起走", () => {
    const name = createFavoriteFolder("动词");
    addFavorite("word", 1, name);
    renameFavoriteFolder(name, "自他动词");

    expect(getFavoriteItems("word", "自他动词").map((item) => item.id)).toEqual(["1"]);
    expect(listFavoriteFolders().map((folder) => folder.name)).toEqual(["自他动词"]);
  });

  // 删夹子最容易顺手把收藏一起删掉 —— 这一条就是钉住「不会」。
  it("删夹子不删收藏，里面的东西回到未分类", () => {
    const name = createFavoriteFolder("考前突击");
    addFavorite("word", 1, name);
    deleteFavoriteFolder(name);

    expect(listFavoriteFolders()).toEqual([]);
    expect(unfiledFavoriteCount()).toBe(1);
    expect(getFavoriteItems("word").map((item) => item.folder)).toEqual([""]);
  });

  // 对端删掉夹子、这台还有收藏挂在上面时，夹子不能连同收藏一起从视图里消失。
  it("收藏行上的夹名即使没有夹子记录也算一个夹子", () => {
    addFavorite("word", 1, "对端建的夹子");
    expect(listFavoriteFolders()).toEqual([{ name: "对端建的夹子", count: 1 }]);
  });

  it("取消收藏仍然是删行", () => {
    addFavorite("word", 1, createFavoriteFolder("动词"));
    expect(toggleFavorite("word", 1).isFavorite).toBe(false);
    expect(Number(one("SELECT COUNT(*) FROM content_favorites"))).toBe(0);
  });
});

describe("当天顽固词", () => {
  const seedReviews = (wordId: number, answers: string[]) => {
    answers.forEach((answer) => testDb.run(
      "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, ?, 0, ?, 'forward')",
      [wordId, answer, studyDate()]
    ));
  };

  beforeEach(() => {
    testDb.run("DELETE FROM reviews");
    // 出厂库的 reviews 还没有方向列（ensureUserTables 才补），手动补上
    testDb.run("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'");
    testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (1), (2), (3), (4)");
    [
      ["fsrs_stability", "REAL"], ["fsrs_difficulty", "REAL"], ["fsrs_due", "TEXT"],
      ["fsrs_last_review", "TEXT"], ["fsrs_state", "INTEGER"], ["fsrs_steps", "INTEGER"],
      ["fsrs_reps", "INTEGER"], ["fsrs_lapses", "INTEGER"]
    ].forEach(([column, type]) => testDb.run(`ALTER TABLE progress ADD COLUMN ${column} ${type}`));
  });

  // 两条判据是 AND：累计 > 8 且今天错够 3 次。
  it("只有「历史顽固 + 今天又打了一架」才算", () => {
    // 1 两条都满足
    seedReviews(1, Array(STUBBORN_DAILY_MISTAKES).fill("forgot"));
    testDb.run("UPDATE progress SET forgot_count = ? WHERE word_id = 1", [TOTAL_FORGOTS + 1]);
    // 2 历史顽固，但今天一次就过了 —— 它今天并不顽固
    seedReviews(2, ["know"]);
    testDb.run("UPDATE progress SET forgot_count = ? WHERE word_id = 2", [TOTAL_FORGOTS + 5]);
    // 3 今天错了三次，但历史很干净 —— 新词头一天磕绊是正常的
    seedReviews(3, Array(STUBBORN_DAILY_MISTAKES).fill("fuzzy"));
    // 4 两条都满足，但今天根本没出现过
    testDb.run("UPDATE progress SET forgot_count = ? WHERE word_id = 4", [TOTAL_FORGOTS + 9]);

    expect(getStubbornWordsToday().map((word) => word.id)).toEqual([1]);
  });

  // ⚠️ 数的是 forgot_count（你一共点过多少次忘记），不是 fsrs_lapses（只在复习态计、
  // 且顽固词每天限量入池）。用 lapses 的话这张表在真实库上一天 0~2 个,等于没有。
  it("累计看的是 forgot_count，不是 fsrs_lapses", () => {
    seedReviews(1, Array(STUBBORN_DAILY_MISTAKES).fill("forgot"));
    testDb.run("UPDATE progress SET forgot_count = 0, fsrs_lapses = 99 WHERE word_id = 1");
    expect(getStubbornWordsToday()).toEqual([]);

    testDb.run("UPDATE progress SET forgot_count = ?, fsrs_lapses = 0 WHERE word_id = 1", [TOTAL_FORGOTS + 1]);
    expect(getStubbornWordsToday().map((word) => word.id)).toEqual([1]);
  });

  // 阈值本身：累计要**大于** 8，正好 8 不算（而且数的是 forgot_count，不是 fsrs_lapses）
  it("累计正好等于阈值不算", () => {
    seedReviews(1, Array(STUBBORN_DAILY_MISTAKES).fill("forgot"));
    testDb.run("UPDATE progress SET forgot_count = ? WHERE word_id = 1", [TOTAL_FORGOTS]);
    expect(getStubbornWordsToday()).toEqual([]);
  });

  it("反向/汉字的流水不算 —— 完成页说的是经典模式这一场", () => {
    for (let i = 0; i < STUBBORN_DAILY_MISTAKES; i += 1) {
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (1, 'forgot', 0, ?, 'reverse')",
        [studyDate()]
      );
    }
    testDb.run("UPDATE progress SET forgot_count = ? WHERE word_id = 1", [TOTAL_FORGOTS + 3]);
    expect(getStubbornWordsToday()).toEqual([]);
  });

  it("带出收藏状态，收过的不会再被「全部收藏」重复收一遍", () => {
    seedReviews(1, Array(STUBBORN_DAILY_MISTAKES).fill("fuzzy"));
    testDb.run("UPDATE progress SET forgot_count = ? WHERE word_id = 1", [TOTAL_FORGOTS + 1]);
    addFavorite("word", 1, createFavoriteFolder("顽固"));
    expect(getStubbornWordsToday()[0]?.isFavorite).toBe(true);
  });
});
