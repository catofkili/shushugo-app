/**
 * 时刻总线的三道闸:一次性标记、每日预算、优先级。
 *
 * 检测器本身的判定在各自的测试里(如 word-api/plan-trend.test.ts),
 * 这里只管「该不该播、播几个、先播谁」。
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

import { collectMoments } from "./index";
import { markMomentFired, momentFired, momentsFiredOn, resetLegacyMigrationForTests } from "./store";
import { MOMENT_DAILY_BUDGET } from "./types";
import { REVIEW_CAP_UNLIMITED } from "../studyPreferences";

const TODAY = "2026-08-14";
const YESTERDAY = "2026-08-13";

const seedReviewTasks = (day: string, count: number) => {
  for (let i = 0; i < count; i += 1) {
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, 'review', ?)",
      [day, i + 1, i + 1]);
  }
};

/** 造一个「今天比昨天少 48 个」的局面,让 plan_trend 检测器有货可报 */
const seedPlanTrend = () => {
  seedReviewTasks(YESTERDAY, 736);
  seedReviewTasks(TODAY, 688);
};

describe("时刻总线", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database();
    testDb.run(`CREATE TABLE stage1_tasks (
      reviewed_on TEXT, word_id INTEGER, task_type TEXT, order_index INTEGER,
      PRIMARY KEY (reviewed_on, word_id)
    )`);
    testDb.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)");
    testDb.run(`CREATE TABLE moments (
      kind TEXT NOT NULL, key TEXT NOT NULL, fired_on TEXT NOT NULL,
      PRIMARY KEY (kind, key)
    )`);
  });

  beforeEach(() => {
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("DELETE FROM app_state");
    testDb.run("DELETE FROM moments");
    prefStore.clear();
    prefStore.set("mn-study-preferences", JSON.stringify({ reviewCap: REVIEW_CAP_UNLIMITED }));
    resetLegacyMigrationForTests();
  });

  it("有事发生就播,文案带上差值", () => {
    seedPlanTrend();
    const found = collectMoments(TODAY);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("plan_trend");
    expect(found[0].text).toContain("48");
  });

  it("同一个时刻只播一次:再调一次就没有了", () => {
    seedPlanTrend();
    expect(collectMoments(TODAY)).toHaveLength(1);
    // 首页每次进度事件都会再 collect 一遍,这里必须是空的,
    // 否则学一批回来同一句话会再蹦一次
    expect(collectMoments(TODAY)).toHaveLength(0);
    expect(collectMoments(TODAY)).toHaveLength(0);
  });

  it("检测出来就当场记账,不等播完", () => {
    seedPlanTrend();
    collectMoments(TODAY);
    expect(momentFired("plan_trend", TODAY)).toBe(true);
    expect(momentsFiredOn(TODAY)).toBe(1);
  });

  it("每日预算用完就不再播,而且不留到明天", () => {
    // 先把今天的预算占满(模拟别的时刻已经播过)
    for (let i = 0; i < MOMENT_DAILY_BUDGET; i += 1) {
      markMomentFired("plan_trend", `占位-${i}`, TODAY);
    }
    seedPlanTrend();
    expect(collectMoments(TODAY)).toHaveLength(0);
    // 丢掉就是丢掉:没有排队,今天这条 plan_trend 不会在明天冒出来
    expect(momentFired("plan_trend", TODAY)).toBe(false);
  });

  it("昨天播过的不占今天的预算", () => {
    markMomentFired("plan_trend", "昨天的某个", YESTERDAY);
    expect(momentsFiredOn(TODAY)).toBe(0);
    seedPlanTrend();
    expect(collectMoments(TODAY)).toHaveLength(1);
  });

  it("没事发生就安静", () => {
    seedReviewTasks(YESTERDAY, 600);
    seedReviewTasks(TODAY, 600);
    expect(collectMoments(TODAY)).toHaveLength(0);
    expect(momentsFiredOn(TODAY)).toBe(0);
  });

  it("老库的 plan_trend_seen_on 搬进台账,升级当天不重播", () => {
    testDb.run("INSERT INTO app_state (key, value) VALUES ('plan_trend_seen_on', ?)", [TODAY]);
    seedPlanTrend();
    expect(collectMoments(TODAY)).toHaveLength(0);
    expect(momentFired("plan_trend", TODAY)).toBe(true);
  });
});
