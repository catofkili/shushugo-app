/**
 * 回归模式端到端测试：用真实种子库跑 word-api 全流程，覆盖温和/高强度双档。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

// 纯 Node 环境:给 studyPreferences 依赖的 localStorage / window 挂最小桩。
const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
};

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));
vi.mock("./progress-events", () => ({
  PROGRESS_UPDATED_EVENT: "test",
  notifyProgressUpdated: () => undefined
}));

import { studyDate, getState, setState } from "./database/db-utils";
import { setFsrsActive } from "./fsrs-store";
import {
  completeTodayWordPlan,
  ensureProgressInitialized,
  getWordSession,
  setComebackModeForToday,
  startComebackEncore,
  submitWordAnswer,
  undoLastWordAnswer
} from "./word-api";

const DAY_MS = 86400000;
const dayString = (daysAgo: number) => studyDate(new Date(Date.now() - daysAgo * DAY_MS));

const HISTORY_DAYS_AGO_START = 18;
const HISTORY_DAYS_AGO_END = 4; // 最后一次打卡在 4 天前 → 完整缺卡 3 天
const DAILY_WORDS = 60; // 日均 60 → 容量 = 60 × 1.5 = 90

/** 把库重置到「缺卡回归前」状态：backlog 个积压词 + 一段打卡历史，清掉回归状态与衰减账 */
const seedBacklog = (backlog: number) => {
  setFsrsActive(false); // 回归模式的这批用例测的是旧分数积压路径,固定跑旧算法
  prefStore.clear();
  testDb.run("DELETE FROM checkins");
  testDb.run("DELETE FROM word_study_time");
  testDb.run("DELETE FROM reviews");
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run("UPDATE progress SET seen_count = 0, score = 0, known_forever = 0, right_streak = 0");
  testDb.run(`UPDATE progress SET seen_count = 3, score = 0, last_seen_on = '${dayString(HISTORY_DAYS_AGO_END)}' WHERE word_id <= ${backlog}`);
  for (let ago = HISTORY_DAYS_AGO_START; ago >= HISTORY_DAYS_AGO_END; ago -= 1) {
    const day = dayString(ago);
    testDb.run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)", [day]);
    testDb.run("INSERT OR REPLACE INTO word_study_time (studied_on, seconds) VALUES (?, ?)", [day, 600]);
    for (let wordId = 1; wordId <= DAILY_WORDS; wordId += 1) {
      testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, 'know', 5, ?)", [wordId, day]);
    }
  }
  setState("comeback_state", "{}");
  setState("last_decay", studyDate()); // 冻结衰减，隔离各场景
  setState("phase_date", "");
};

describe("comeback mode", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    vi.setSystemTime(noon);

    const SQL = await initSqlJs();
    const dbPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
    testDb = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
    ensureProgressInitialized();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    vi.setSystemTime(noon);
  });

  it("温和档：7 天计划、由轻到重的第一天、暂停新词", () => {
    seedBacklog(400);
    const { stats } = getWordSession();

    expect(stats.comeback?.active).toBe(true);
    expect(stats.comeback?.mode).toBe("gentle");
    expect(stats.comeback?.dayIndex).toBe(1);
    expect(stats.comeback?.planDays).toBe(7);
    expect(stats.comeback?.initialBacklog).toBe(400);
    // 第一天是阶梯最轻的一档，明显低于容量 90
    expect(stats.comeback?.todayTarget).toBeLessThan(90);
    expect(stats.comeback?.todayTarget).toBeGreaterThan(0);
    expect(stats.stage1ProgressTotal).toBe(stats.comeback?.todayTarget);
    // 新词暂停
    expect(stats.newQuota).toBe(0);
  });

  it("温和档：跨天 planDays 冻结不上涨(修复逐日 +1 的老 bug)", () => {
    seedBacklog(400);
    const day1 = getWordSession().stats.comeback?.planDays;
    completeTodayWordPlan();

    vi.setSystemTime(new Date(Date.now() + DAY_MS));
    const secondDay = getWordSession().stats.comeback;
    expect(secondDay?.dayIndex).toBe(2);
    expect(secondDay?.planDays).toBe(day1); // 依然 7，不因积压涨到 8
    expect(secondDay?.planDays).toBe(7);
  });

  it("高强度档：2~3 天快清，第一天量远高于温和", () => {
    prefStore.set("mn-study-preferences", JSON.stringify({ comebackMode: "pressure" }));
    seedBacklog(400); // seedBacklog 会清 prefStore，需在其后再设
    prefStore.set("mn-study-preferences", JSON.stringify({ comebackMode: "pressure" }));

    const { stats } = getWordSession();
    expect(stats.comeback?.mode).toBe("pressure");
    // 400 / 250 → 2 天
    expect(stats.comeback?.planDays).toBe(2);
    // 均摊 → 约 200/天，远高于温和第一天
    expect(stats.comeback?.todayTarget).toBeGreaterThan(150);
  });

  it("积压清到一天以内 → 退出回归，新词配额回归", () => {
    seedBacklog(400);
    getWordSession();
    // 手动把积压全部救回（score>6），只留极少
    testDb.run("UPDATE progress SET score = 12 WHERE known_forever = 0 AND seen_count > 0 AND score <= 6");

    vi.setSystemTime(new Date(Date.now() + DAY_MS));
    const { stats } = getWordSession();
    expect(stats.comeback).toBeUndefined();
    expect(stats.newQuota).toBeGreaterThan(0);
  });

  it("完成当天计划后给出递减续杯", () => {
    seedBacklog(400);
    getWordSession();
    const { stats } = completeTodayWordPlan();

    expect(stats.taskDone).toBe(true);
    expect(stats.encore?.available).toBe(true);
    expect(stats.encore?.size).toBeGreaterThan(0);
    expect(stats.encore?.remaining).toBeGreaterThan(0);

    const encoreSession = startComebackEncore();
    expect(encoreSession.phase).toBe("stage1");
    expect(encoreSession.card).not.toBeNull();
    expect(encoreSession.stats.encore?.weekEncoreCount).toBe(1);
  });

  it("撤销后回到刚答的那张卡，而不是另选一张", () => {
    seedBacklog(400);
    const beforeAnswer = getWordSession();
    expect(beforeAnswer.card).not.toBeNull();

    submitWordAnswer(beforeAnswer.card!.id, "know");
    const undone = undoLastWordAnswer();
    expect(undone.card?.id).toBe(beforeAnswer.card!.id);
  });

  it("欢迎卡当场切档：重排今日计划、planDays 随之变", () => {
    seedBacklog(400);
    const gentle = getWordSession().stats.comeback;
    expect(gentle?.mode).toBe("gentle");
    expect(gentle?.planDays).toBe(7);

    const switched = setComebackModeForToday("pressure");
    expect(switched.comeback?.mode).toBe("pressure");
    expect(switched.comeback?.planDays).toBe(2); // 400/250 → 2 天
    // 今日目标从温和第一天(轻)跳到高强度均摊(重)
    expect(switched.comeback!.todayTarget).toBeGreaterThan(gentle!.todayTarget);
  });

  it("回归节奏偏好读取自持久化设置（默认温和）", () => {
    seedBacklog(400);
    expect(getState("comeback_state", "{}")).not.toBe("");
    expect(getWordSession().stats.comeback?.mode).toBe("gentle");
  });
});
