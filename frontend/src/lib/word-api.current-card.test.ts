/**
 * current_card 抢占锁的回归：计划版本号变更的那一次作答不许被静默吞掉。
 *
 * getWordSession() 会先发牌并写 current_card，再在统计路径里确保正向计划。
 * 如果计划版本重排顺手清掉全局 current_card，筛选学习发出的那张牌就会被
 * submitWordAnswer() 当成过期提交，既不写 reviews，也不推进 FSRS。
 */
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
vi.mock("./storage", () => ({
  scheduleSave: () => undefined,
  requestFullSnapshot: () => undefined,
  persistSoon: () => undefined
}));
vi.mock("./progress-events", () => ({
  PROGRESS_UPDATED_EVENT: "test",
  notifyProgressUpdated: () => undefined
}));

import { ensureProgressInitialized, getWordSession, submitWordAnswer } from "./word-api";
import { getState, setState, studyDate } from "./database/db-utils";

const today = () => studyDate();
const staleThePlanVersion = () => setState("stage1_plan_version", "regression-old-version");
const reviewCountFor = (wordId: number) => testDb.exec(
  `SELECT COUNT(*) FROM reviews WHERE word_id = ${wordId} AND reviewed_on = '${today()}'`
)[0].values[0][0] as number;

describe("current_card · 计划版本号变更", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    vi.setSystemTime(noon);
    const SQL = await initSqlJs();
    const seed = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
    testDb = new SQL.Database(new Uint8Array(readFileSync(seed)));
    ensureProgressInitialized();
  });

  afterAll(() => vi.useRealTimers());

  beforeEach(() => {
    prefStore.clear();
    testDb.run("DELETE FROM reviews");
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("DELETE FROM stage2_progress");
    testDb.run("DELETE FROM kanji_progress");
    testDb.run("UPDATE progress SET seen_count = 0, score = 0, known_forever = 0, fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL, fsrs_state = NULL, fsrs_last_review = NULL");
    setState("phase_date", today());
    setState("phase", "stage1");
    setState("current_card", "");
    setState("review_queue", "[]");
    setState("last_answered_word", "0");
  });

  it("筛选学习发出的卡不会被统计路径清锁", () => {
    staleThePlanVersion();
    const options = { level: "N3" as const };
    const card = getWordSession(options).card;
    expect(card).not.toBeNull();
    expect(getState("current_card", "")).toBe(String(card!.id));

    submitWordAnswer(card!.id, "know", options);
    expect(reviewCountFor(card!.id)).toBe(1);
  });

  it("重复提交仍只记录一次", () => {
    const card = getWordSession().card;
    expect(card).not.toBeNull();
    submitWordAnswer(card!.id, "know");
    submitWordAnswer(card!.id, "know");
    expect(reviewCountFor(card!.id)).toBe(1);
  });
});
