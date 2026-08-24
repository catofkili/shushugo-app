import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { studyTotals } from "./study-totals";

const seed = async (time: [string, number][], reviewDays: string[]) => {
  const SQL = await initSqlJs();
  testDb = new SQL.Database();
  testDb.run("CREATE TABLE word_study_time (studied_on TEXT PRIMARY KEY, seconds INTEGER, updated_at TEXT)");
  testDb.run("CREATE TABLE reviews (id INTEGER PRIMARY KEY, word_id INTEGER, reviewed_on TEXT)");
  time.forEach(([day, seconds]) => testDb.run("INSERT INTO word_study_time VALUES (?,?,?)", [day, seconds, day]));
  reviewDays.forEach((day, index) => testDb.run("INSERT INTO reviews VALUES (?,?,?)", [index + 1, index + 1, day]));
};

describe("累计学习时长和天数", () => {
  beforeEach(() => { testDb?.close?.(); });

  it("先把各天的秒加起来再取整分钟,不是每天各自取整", async () => {
    // 3660 + 59 = 3719 秒 = 61.98 分。逐天取整会得到 61 + 0 = 61,
    // 这里也是 61,但换成 [59, 59] 就能看出差别:逐天取整是 0,求和取整是 1。
    await seed([["2026-08-20", 3660], ["2026-08-21", 59]], []);
    expect(studyTotals().minutes).toBe(61);
    await seed([["2026-08-20", 59], ["2026-08-21", 59]], []);
    expect(studyTotals().minutes).toBe(1);
  });

  it("天数取并集 —— 计时是后来才有的,更早的复习记录不能漏", async () => {
    await seed(
      [["2026-08-20", 600], ["2026-08-21", 600]],
      ["2026-06-01", "2026-06-01", "2026-08-20"]   // 6/1 早于计时,8/20 和计时那天重合
    );
    expect(studyTotals().days).toBe(3);
  });

  it("只记了 0 秒的那天不算学过", async () => {
    await seed([["2026-08-20", 0]], []);
    expect(studyTotals()).toEqual({ minutes: 0, days: 0 });
  });

  it("空库不炸", async () => {
    await seed([], []);
    expect(studyTotals()).toEqual({ minutes: 0, days: 0 });
  });
});
