import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let prepareCalls = 0;

vi.mock("../database", () => ({
  getDatabase: () => new Proxy(testDb, {
    get(target, key, receiver) {
      if (key === "prepare") prepareCalls += 1;
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }),
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("../study-core", () => ({ ensureUserTables: () => undefined, persistSoon: () => undefined }));

import { achievementStats } from "./stats";
import { ACHIEVEMENTS } from "./catalog";
import { achievementBoard, evaluateAchievements, unlockedAchievementIds } from "./index";

/** answers 按顺序写成 reviews；day 用来分「学习日」 */
const seed = async (answers: string[], day = "2026-08-20") => {
  const SQL = await initSqlJs();
  testDb = new SQL.Database();
  testDb.run(`CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, word_id INTEGER, answer TEXT,
    reviewed_on TEXT, created_at TEXT, direction TEXT DEFAULT 'forward')`);
  testDb.run("CREATE TABLE progress (word_id INTEGER PRIMARY KEY, fsrs_due TEXT, fsrs_last_review TEXT, fsrs_lapses INTEGER)");
  testDb.run("CREATE TABLE word_study_time (studied_on TEXT PRIMARY KEY, seconds INTEGER)");
  testDb.run("CREATE TABLE achievements (id TEXT PRIMARY KEY, unlocked_on TEXT NOT NULL)");
  answers.forEach((answer, index) => {
    testDb.run("INSERT INTO reviews (word_id, answer, reviewed_on, created_at) VALUES (?,?,?,?)",
      [index + 1, answer, day, `${day} 10:00:0${index % 10}`]);
  });
  prepareCalls = 0;
};

describe("成就目录", () => {
  it("id 不重复、字段齐全、目标值合法", () => {
    const ids = ACHIEVEMENTS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    ACHIEVEMENTS.forEach((item) => {
      expect(item.name.length, item.id).toBeGreaterThan(0);
      expect(item.description.length, item.id).toBeGreaterThan(0);
      expect(item.emoji.length, item.id).toBeGreaterThan(0);
      expect(item.goal, item.id).toBeGreaterThanOrEqual(1);
    });
  });

  it("隐藏成就不能太多 —— 一眼望去全是问号就没意思了", () => {
    const hidden = ACHIEVEMENTS.filter((item) => item.hidden).length;
    expect(hidden).toBeLessThan(ACHIEVEMENTS.length / 4);
  });
});

describe("结算", () => {
  beforeEach(() => { prepareCalls = 0; });

  it("空库一个都不给 —— 新用户不该白捡成就", async () => {
    await seed([]);
    expect(evaluateAchievements({ force: true })).toEqual([]);
  });

  it("连着点 10 次忘记 → 先冷静；9 次不算", async () => {
    await seed(Array(9).fill("forgot"));
    expect(evaluateAchievements({ force: true }).map((item) => item.id)).not.toContain("forgot-streak-10");

    await seed(Array(10).fill("forgot"));
    expect(evaluateAchievements({ force: true }).map((item) => item.id)).toContain("forgot-streak-10");
  });

  it("中间夹一个别的答案就断了", async () => {
    await seed([...Array(5).fill("forgot"), "know", ...Array(5).fill("forgot")]);
    expect(evaluateAchievements({ force: true }).map((item) => item.id)).not.toContain("forgot-streak-10");
  });

  it("上线即追认：历史里早就发生过的照样补发", async () => {
    // 十次忘记发生在最前面,后面又答对了一堆 —— 装上这版仍然该给
    await seed([...Array(12).fill("forgot"), ...Array(30).fill("know")]);
    const earned = evaluateAchievements({ force: true }).map((item) => item.id);
    expect(earned).toContain("forgot-streak-10");
    expect(earned).toContain("know-streak-25");
  });

  it("解锁只发一次,重复结算不会再报", async () => {
    await seed(Array(10).fill("forgot"));
    expect(evaluateAchievements({ force: true }).length).toBeGreaterThan(0);
    expect(evaluateAchievements({ force: true })).toEqual([]);
    expect(unlockedAchievementIds().has("forgot-streak-10")).toBe(true);
  });

  it("默认有节流,学习页每 15 秒叫一次不会每次都扫库", async () => {
    await seed(Array(10).fill("forgot"));
    evaluateAchievements({ force: true });
    await seed(Array(20).fill("forgot"));   // 库换了,但节流窗口还没过
    expect(evaluateAchievements()).toEqual([]);
  });
});

describe("取数是懒的", () => {
  it("建统计对象本身不查库,碰到哪个字段才查哪个", async () => {
    await seed(Array(3).fill("know"));
    const stats = achievementStats();
    expect(prepareCalls).toBe(0);
    void stats.totalReviews;
    const afterFirst = prepareCalls;
    expect(afterFirst).toBeGreaterThan(0);
    void stats.totalReviews;             // 第二次读同一个字段
    expect(prepareCalls).toBe(afterFirst); // 记住了,没再查
  });

  it("少一张表只让对应成就拿不到,不会把结算炸掉", async () => {
    await seed(Array(3).fill("know"));
    testDb.run("DROP TABLE word_study_time");
    expect(() => achievementBoard()).not.toThrow();
  });
});
