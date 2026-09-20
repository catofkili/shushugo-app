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
vi.mock("../storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));
vi.mock("../progress-events", () => ({
  PROGRESS_UPDATED_EVENT: "test",
  notifyProgressUpdated: () => undefined
}));

import { ensureProgressInitialized } from "./bootstrap";
import { createStage1Tasks } from "./stage1";

const DAY1 = "2026-08-03";
const DAY2 = "2026-08-04";

const setGoal = (n: number) => prefStore.set("mn-study-preferences", JSON.stringify({ dailyGoal: n }));

const newTasks = (day: string) => {
  const st = testDb.prepare(
    "SELECT word_id FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'new' ORDER BY order_index"
  );
  st.bind([day]);
  const out: number[] = [];
  while (st.step()) out.push(Number(st.getAsObject().word_id));
  st.free();
  return out;
};

/** 把这些词做成「今天到期的复习」，用来堆积压 */
const makeDue = (count: number) => {
  testDb.run(`
    UPDATE progress
    SET known_forever = 0, seen_count = 5, fsrs_stability = 2, fsrs_difficulty = 5,
        fsrs_due = '2026-08-01T00:00:00.000Z', fsrs_last_review = '2026-07-30T00:00:00.000Z',
        fsrs_state = 2, fsrs_steps = 0, fsrs_reps = 5, fsrs_lapses = 0
    WHERE word_id IN (SELECT word_id FROM progress ORDER BY word_id LIMIT ?)
  `, [count]);
};

/** 剩下的全是没学过的新词候选 */
const resetProgress = () => {
  testDb.run("DELETE FROM reviews");
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run(`
    UPDATE progress
    SET known_forever = 0, seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
        last_seen_on = NULL, fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL,
        fsrs_last_review = NULL, fsrs_state = NULL, fsrs_steps = NULL, fsrs_reps = NULL, fsrs_lapses = NULL
  `);
};

describe("每日新词名额", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-03T12:00:00+08:00"));
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url)))));
    ensureProgressInitialized();
  });

  beforeEach(() => {
    resetProgress();
    setGoal(30);
  });

  afterAll(() => vi.useRealTimers());

  it("复习堆积多少都不减新词名额 —— 用户设的那个数说了算", () => {
    makeDue(600);
    createStage1Tasks(DAY1);
    expect(newTasks(DAY1)).toHaveLength(30);
  });

  it("一天没背,第二天还是 30 个,不是 60", () => {
    createStage1Tasks(DAY1);
    expect(newTasks(DAY1)).toHaveLength(30);

    // 一个都没答,直接过一天
    vi.setSystemTime(new Date("2026-08-04T12:00:00+08:00"));
    createStage1Tasks(DAY2);
    expect(newTasks(DAY2)).toHaveLength(30);
  });

  it("没背到的那些第二天优先回来,不是被丢回随机池", () => {
    createStage1Tasks(DAY1);
    const planned = newTasks(DAY1);
    expect(planned).toHaveLength(30);

    // 只学了前 5 个
    const studied = planned.slice(0, 5);
    studied.forEach((wordId) => {
      testDb.run("UPDATE progress SET seen_count = 1, last_seen_on = ? WHERE word_id = ?", [DAY1, wordId]);
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'know', 0, ?, 'forward')",
        [wordId, DAY1]
      );
    });

    vi.setSystemTime(new Date("2026-08-04T12:00:00+08:00"));
    createStage1Tasks(DAY2);
    const next = newTasks(DAY2);

    expect(next).toHaveLength(30);
    // 昨天排了却没背到的 25 个,今天必须全在
    const missed = planned.slice(5);
    expect(missed.filter((id) => next.includes(id))).toHaveLength(25);
    // 而且排在前面 —— 等最久的先回来
    expect(next.slice(0, 25).sort()).toEqual([...missed].sort());
    // 已经学过的不再当新词发
    expect(next.filter((id) => studied.includes(id))).toHaveLength(0);
  });

  it("改额度是补抽不是重建：答过的留着，今天答过的非计划词（快速学习 / 压轴）不回填成任务", () => {
    resetProgress();
    makeDue(40);
    setGoal(10);
    createStage1Tasks(DAY1);
    const before = testDb.exec("SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?", [DAY1])[0].values[0][0];
    // 计划外答了 3 个词（快速学习那种），再把新词额度从 10 改到 5：这 3 个不该变成任务
    testDb.run("UPDATE progress SET seen_count = 9, fsrs_due = '2026-09-01T00:00:00.000Z' WHERE word_id IN (9001, 9002, 9003)");
    for (const id of [9001, 9002, 9003]) {
      testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'know', 0, ?, 'forward')", [id, DAY1]);
    }
    setGoal(5);
    testDb.run(
      "DELETE FROM stage1_tasks WHERE reviewed_on = ? AND word_id NOT IN (SELECT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward')",
      [DAY1, DAY1]
    );
    createStage1Tasks(DAY1, { topUp: true });
    const ids = testDb.exec("SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?", [DAY1])[0].values.map((v) => Number(v[0]));
    expect(ids).not.toContain(9001);
    expect(newTasks(DAY1)).toHaveLength(5);
    expect(ids.length).toBe(Number(before) - 5);
  });
});
