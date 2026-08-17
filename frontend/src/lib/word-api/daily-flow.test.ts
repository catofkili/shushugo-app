import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = { dispatchEvent: () => true };

vi.mock("../database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("../storage", () => ({ scheduleSave: () => undefined }));
vi.mock("../progress-events", () => ({
  PROGRESS_UPDATED_EVENT: "test",
  notifyProgressUpdated: () => undefined
}));

import { ensureProgressInitialized } from "./bootstrap";
import { setState, studyDayEnd, today } from "../study-core";
import { advanceDailyRelief, ensureDailyRelief, getDailyReliefNext } from "./daily-relief";
import { ensureDailyTail, getDailyTailNext } from "./daily-tail";
import { pickDailyReviewNext, shouldStartDailyReview } from "./daily-review";
import { STAGE1_PLAN_VERSION } from "./stage1";
import { getWordStats } from "./stats";

const day = "2026-08-03";
const yesterday = "2026-08-02";

const clearFlowState = () => {
  testDb.run("DELETE FROM reviews");
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run("DELETE FROM app_state WHERE key IN ('daily_relief_v1', 'daily_tail_v1')");
  testDb.run(`
    UPDATE progress
    SET known_forever = 1,
        seen_count = 0,
        right_count = 0,
        fuzzy_count = 0,
        forgot_count = 0,
        last_seen_on = NULL,
        fsrs_stability = NULL,
        fsrs_difficulty = NULL,
        fsrs_due = NULL,
        fsrs_last_review = NULL,
        fsrs_state = NULL,
        fsrs_steps = NULL,
        fsrs_reps = NULL,
        fsrs_lapses = NULL
  `);
  setState("phase_date", today());
  setState("phase", "stage1");
  setState("current_card", "0");
  setState("stage1_plan_version", STAGE1_PLAN_VERSION);
}

const makeFutureWord = (wordId: number) => {
  const due = new Date("2026-08-10T04:00:00.000Z").toISOString();
  testDb.run(`
    UPDATE progress
    SET known_forever = 0, seen_count = 8, right_count = 8,
        last_seen_on = ?, fsrs_stability = 90, fsrs_difficulty = 3,
        fsrs_due = ?, fsrs_last_review = ?, fsrs_state = 2,
        fsrs_steps = 0, fsrs_reps = 8, fsrs_lapses = 0
    WHERE word_id = ?
  `, [yesterday, due, new Date("2026-08-02T12:00:00.000Z").toISOString(), wordId]);
};

describe("昨日减负、当日错题与真正结尾", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-03T12:00:00+08:00"));
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url)))));
    ensureProgressInitialized();
  });

  beforeEach(() => clearFlowState());

  afterAll(() => {
    vi.useRealTimers();
  });

  it("只选昨天记住、今天不在计划的6-12个词，并且不写复习流水", () => {
    Array.from({ length: 6 }, (_, index) => index + 2).forEach((wordId, index) => {
      makeFutureWord(wordId);
      for (let repeat = 0; repeat <= index; repeat += 1) {
        testDb.run(
          "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'know', 0, ?, 'forward')",
          [wordId, yesterday]
        );
      }
    });
    makeFutureWord(1);
    testDb.run(
      "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (1, 'know', 0, ?, 'forward')",
      [yesterday]
    );
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, 1, 'review', 1)", [day]);
    for (let wordId = 8; wordId <= 13; wordId += 1) {
      testDb.run(
        "INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, 'new', ?)",
        [day, wordId, wordId]
      );
    }

    const state = ensureDailyRelief();
    expect(state.wordIds).toEqual([2, 3, 4, 5, 6, 7]);
    expect(getDailyReliefNext()?.id).toBe(2);
    advanceDailyRelief();
    expect(getDailyReliefNext()?.id).toBe(3);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM reviews")[0].values[0][0])).toBe(22);
    // 减负只清后台奖励卡,今日计划(包括新词)一张都不能被删。
    expect(Number(testDb.exec("SELECT COUNT(*) FROM stage1_tasks")[0].values[0][0])).toBe(7);
  });

  it("只在60%-80%且四张以上今日四次未清词时触发当日错题回顾", () => {
    for (let wordId = 1; wordId <= 10; wordId += 1) {
      testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, 'review', ?)", [day, wordId, wordId]);
    }
    for (let wordId = 1; wordId <= 6; wordId += 1) {
      testDb.run("UPDATE progress SET known_forever = 1, seen_count = 8 WHERE word_id = ?", [wordId]);
    }
    for (let wordId = 7; wordId <= 10; wordId += 1) {
      testDb.run("UPDATE progress SET known_forever = 0, seen_count = 8, fsrs_due = ? WHERE word_id = ?", [studyDayEnd().toISOString(), wordId]);
      for (let repeat = 0; repeat < 4; repeat += 1) {
        testDb.run(
          "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'fuzzy', 0, ?, 'forward')",
          [wordId, day]
        );
      }
    }
    expect(shouldStartDailyReview()).toBe(true);
    expect(pickDailyReviewNext()?.id).toBe(7);

    // 最近20次全部失败且总量已达到疲劳阈值时,即使其它条件仍满足也不再开回顾区。
    for (let repeat = 0; repeat < 24; repeat += 1) {
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (1, 'know', 0, ?, 'forward')",
        [day]
      );
    }
    for (let repeat = 0; repeat < 20; repeat += 1) {
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (1, 'forgot', 0, ?, 'forward')",
        [day]
      );
    }
    expect(shouldStartDailyReview()).toBe(false);
  });

  it("压轴只从高预测回忆率词中抽3-7张，并且按天保存", () => {
    for (let wordId = 1; wordId <= 6; wordId += 1) makeFutureWord(wordId);
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id = 1");
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, 1, 'review', 1)", [day]);
    const state = ensureDailyTail();
    expect(state.wordIds.length).toBeGreaterThanOrEqual(3);
    expect(state.wordIds.length).toBeLessThanOrEqual(7);
    expect(getDailyTailNext()?.id).toBe(state.wordIds[0]);
    expect(ensureDailyTail()).toEqual(state);
    expect(testDb.exec("SELECT COUNT(*) FROM stage1_tasks")[0].values[0][0]).toBe(1);
    const stats = getWordStats();
    expect(stats.stage1ProgressTotal).toBe(1 + state.wordIds.length);
    expect(stats.stage1ProgressDone).toBe(1);
    expect(stats.stage1Done).toBe(true);
    expect(stats.dailyPlanDone).toBe(false);
  });

  it("学习页的今日掌握数使用 FSRS,不读恒为0的 score_after", () => {
    testDb.run(`
      UPDATE progress
      SET known_forever = 0,
          seen_count = 3,
          fsrs_stability = 30,
          fsrs_last_review = '2026-01-01T12:00:00.000Z',
          fsrs_due = '2026-08-10T04:00:00.000Z',
          fsrs_state = 2
      WHERE word_id = 1
    `);
    testDb.run(
      "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (1, 'know', 0, ?, 'forward')",
      [day]
    );

    expect(getWordStats().masteredToday).toBe(1);
  });
});
