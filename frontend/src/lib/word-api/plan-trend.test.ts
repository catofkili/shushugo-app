/**
 * 「比昨天少 N 个」的判定:只在积压真的降了、且今天的数字没被复习上限截断时报喜。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => prefStore.get(k) ?? null,
  setItem: (k: string, v: string) => { prefStore.set(k, String(v)); },
  removeItem: (k: string) => { prefStore.delete(k); },
  clear: () => prefStore.clear()
};

vi.mock("../database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb, exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("../storage", () => ({ scheduleSave: () => undefined }));

import { dailyPlanTrend } from "./plan-trend";
import { REVIEW_CAP_UNLIMITED } from "../studyPreferences";

const TODAY = "2026-08-14";
const YESTERDAY = "2026-08-13";

/** 偏好存 localStorage,没有 setter,直接写(saveStudyPreferences 要 window 事件) */
const setReviewCap = (reviewCap: number) =>
  prefStore.set("mn-study-preferences", JSON.stringify({ reviewCap }));

const seedTasks = (day: string, reviews: number, news = 0) => {
  for (let i = 0; i < reviews; i += 1) {
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, 'review', ?)",
      [day, i + 1, i + 1]);
  }
  for (let i = 0; i < news; i += 1) {
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, 'new', ?)",
      [day, 90000 + i, reviews + i + 1]);
  }
};

describe("每日计划趋势", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database();
    testDb.run(`CREATE TABLE stage1_tasks (
      reviewed_on TEXT, word_id INTEGER, task_type TEXT, order_index INTEGER,
      PRIMARY KEY (reviewed_on, word_id)
    )`);
    testDb.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)");
  });

  beforeEach(() => {
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("DELETE FROM app_state");
    prefStore.clear();
    setReviewCap(REVIEW_CAP_UNLIMITED);
  });

  it("今天比昨天少 → 报出差值", () => {
    seedTasks(YESTERDAY, 736, 15);
    seedTasks(TODAY, 688, 15);
    expect(dailyPlanTrend(TODAY)).toEqual({ today: 688, yesterday: 736, delta: 48 });
  });

  it("新词配额变了不算积压变化:只数复习任务", () => {
    seedTasks(YESTERDAY, 700, 5);
    seedTasks(TODAY, 700, 30);   // 总数从 705 涨到 730,复习没动
    expect(dailyPlanTrend(TODAY)).toBeNull();
  });

  it("持平或变多 → 不说", () => {
    seedTasks(YESTERDAY, 600);
    seedTasks(TODAY, 600);
    expect(dailyPlanTrend(TODAY)).toBeNull();

    testDb.run("DELETE FROM stage1_tasks WHERE reviewed_on = ?", [TODAY]);
    seedTasks(TODAY, 640);
    expect(dailyPlanTrend(TODAY)).toBeNull();
  });

  it("昨天没排过计划 → 没有可比的账,不说", () => {
    seedTasks(TODAY, 120);
    expect(dailyPlanTrend(TODAY)).toBeNull();
  });

  it("今天的数字被复习上限截断 → 不说(那是上限不是积压)", () => {
    setReviewCap(150);
    seedTasks(YESTERDAY, 300);
    seedTasks(TODAY, 150);
    expect(dailyPlanTrend(TODAY)).toBeNull();
  });

  it("上限存在但没顶到 → 照常报喜", () => {
    setReviewCap(150);
    seedTasks(YESTERDAY, 140);
    seedTasks(TODAY, 100);
    expect(dailyPlanTrend(TODAY)?.delta).toBe(40);
  });

  it("积压清空到 0 也算数", () => {
    seedTasks(YESTERDAY, 30);
    expect(dailyPlanTrend(TODAY)).toEqual({ today: 0, yesterday: 30, delta: 30 });
  });
});
