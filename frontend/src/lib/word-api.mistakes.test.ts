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

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import { ensureProgressInitialized, getWordSession, submitWordAnswer } from "./word-api";
import { setFsrsActive } from "./fsrs-store";
import { setState, studyDayEnd, today } from "./study-core";

const mistakeOptions = { focus: "mistakes" as const };

describe("学习错题本", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-03T12:00:00+08:00"));
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    ensureProgressInitialized();
    setFsrsActive(true);
  });

  beforeEach(() => {
    testDb.run("DELETE FROM reviews");
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run(`
      UPDATE progress
      SET known_forever = 1,
          seen_count = 0,
          right_count = 0,
          fuzzy_count = 0,
          forgot_count = 0,
          mistake_streak = 0,
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
    setState("phase", "done");
    setState("review_queue", "[]");
    setState("current_card", "0");
    setState("last_answer", "");
  });

  afterAll(() => {
    setFsrsActive(false);
    vi.useRealTimers();
  });

  it("从共用 FSRS 记忆中挑出长期薄弱词，即使常规计划已经结束", () => {
    const yesterday = "2026-08-02";
    const lastReview = new Date("2026-08-02T04:00:00.000Z").toISOString();
    const futureDue = new Date("2026-08-20T04:00:00.000Z").toISOString();
    testDb.run(`
      UPDATE progress
      SET known_forever = 0,
          seen_count = 8,
          right_count = 4,
          fuzzy_count = 2,
          forgot_count = 2,
          last_seen_on = ?,
          fsrs_stability = 18,
          fsrs_difficulty = 8,
          fsrs_due = ?,
          fsrs_last_review = ?,
          fsrs_state = 2,
          fsrs_steps = 0,
          fsrs_reps = 8,
          fsrs_lapses = 2
      WHERE word_id = 1
    `, [yesterday, futureDue, lastReview]);

    const session = getWordSession(mistakeOptions);
    expect(session.phase).toBe("mistakes");
    expect(session.card?.id).toBe(1);
  });

  it("答题写回原 reviews/progress/FSRS，答稳后退出当天错题轮次", () => {
    const lastReview = new Date("2026-08-01T04:00:00.000Z").toISOString();
    const due = new Date("2026-08-02T04:00:00.000Z").toISOString();
    testDb.run(`
      UPDATE progress
      SET known_forever = 0,
          seen_count = 6,
          right_count = 2,
          fuzzy_count = 2,
          forgot_count = 2,
          last_seen_on = '2026-08-01',
          fsrs_stability = 5,
          fsrs_difficulty = 8,
          fsrs_due = ?,
          fsrs_last_review = ?,
          fsrs_state = 2,
          fsrs_steps = 0,
          fsrs_reps = 6,
          fsrs_lapses = 2
      WHERE word_id = 1
    `, [due, lastReview]);

    const card = getWordSession(mistakeOptions).card;
    expect(card?.id).toBe(1);
    const next = submitWordAnswer(card!.id, "know", mistakeOptions);

    const review = testDb.exec("SELECT word_id, answer FROM reviews ORDER BY id DESC LIMIT 1")[0].values[0];
    const progress = testDb.exec("SELECT seen_count, last_seen_on, fsrs_due FROM progress WHERE word_id = 1")[0].values[0];
    expect(review).toEqual([1, "know"]);
    expect(Number(progress[0])).toBe(7);
    expect(String(progress[1])).toBe(today());
    expect(new Date(String(progress[2])).getTime()).toBeGreaterThan(studyDayEnd().getTime());
    expect(next.phase).toBe("mistakes");
    expect(next.card).toBeNull();
  });

  it("不会把只是到期、但长期表现稳定的词误收进错题本", () => {
    testDb.run(`
      UPDATE progress
      SET known_forever = 0,
          seen_count = 10,
          right_count = 10,
          last_seen_on = '2026-08-01',
          fsrs_stability = 30,
          fsrs_difficulty = 3,
          fsrs_due = '2026-08-02T04:00:00.000Z',
          fsrs_last_review = '2026-07-01T04:00:00.000Z',
          fsrs_state = 2,
          fsrs_steps = 0,
          fsrs_reps = 10,
          fsrs_lapses = 0
      WHERE word_id = 2
    `);

    expect(getWordSession(mistakeOptions).card).toBeNull();
  });
});
