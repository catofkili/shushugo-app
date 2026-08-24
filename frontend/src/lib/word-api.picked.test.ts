/**
 * 自选清单：词库里勾一批词，开一场只含这些词的学习。
 *
 * 盯三件事：出题范围只有勾中的那些；**没到期的也出**（考前突击就是要提前刷）；
 * 答完并被排到明天以后的词退出本轮，不会在同一场里被问第二遍
 * （那才是在给 FSRS 灌「记住了」的假数据）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined
};

vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, persistSoon: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import {
  ensureProgressInitialized,
  getWordSession,
  pickedProgress,
  startPickedStudy,
  submitWordAnswer
} from "./word-api";

const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const PICKED = [101, 202, 303, 404];
const options = { focus: "picked" } as const;

const daysAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  prefStore.clear();
  ensureProgressInitialized();
  testDb.run("DELETE FROM reviews");
  testDb.run("DELETE FROM stage1_tasks");
  // 勾中的四个都学过，而且**都排到 30 天后**：正常通道今天一个也不会出
  testDb.run(`
    UPDATE progress SET
      seen_count = 5, known_forever = 0, last_seen_on = NULL,
      fsrs_stability = 30.0, fsrs_difficulty = 4.0, fsrs_state = 2,
      fsrs_reps = 5, fsrs_lapses = 0, fsrs_last_review = ?, fsrs_due = ?
    WHERE word_id IN (${PICKED.join(",")})
  `, [daysAgo(1), daysAhead(30)]);
});

describe("自选清单", () => {
  it("只出勾中的词，没到期也出", () => {
    startPickedStudy(PICKED);
    const seen = new Set<number>();
    for (let index = 0; index < 12; index += 1) {
      const session = getWordSession(options);
      expect(session.phase).toBe("picked");
      if (!session.card) break;
      seen.add(session.card.id);
      submitWordAnswer(session.card.id, "know", options);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(PICKED);
  });

  it("答过并排到明天以后的词退出本轮，一场里不会问第二遍", () => {
    startPickedStudy(PICKED);
    const answered: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const session = getWordSession(options);
      if (!session.card) break;
      answered.push(session.card.id);
      submitWordAnswer(session.card.id, "know", options);
    }
    expect(answered.length).toBe(PICKED.length);
    expect(new Set(answered).size).toBe(PICKED.length);
    expect(getWordSession(options).card).toBeNull();
    expect(pickedProgress()).toEqual({ total: 4, remaining: 0 });
  });

  it("答错的词还会在本轮回来", () => {
    startPickedStudy([PICKED[0], PICKED[1]]);
    const first = getWordSession(options).card;
    expect(first).not.toBeNull();
    submitWordAnswer(first!.id, "forgot", options);
    const ids: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const card = getWordSession(options).card;
      if (!card) break;
      ids.push(card.id);
      submitWordAnswer(card.id, index === 0 ? "know" : "know", options);
    }
    // 忘掉的那张被 FSRS 排到几分钟后（仍在本学习日内），所以还会再出现
    expect(ids).toContain(first!.id);
  });

  it("标了熟知的词不进清单", () => {
    testDb.run(`UPDATE progress SET known_forever = 1 WHERE word_id = ${PICKED[0]}`);
    startPickedStudy(PICKED);
    const ids = new Set<number>();
    for (let index = 0; index < 10; index += 1) {
      const card = getWordSession(options).card;
      if (!card) break;
      ids.add(card.id);
      submitWordAnswer(card.id, "know", options);
    }
    expect(ids.has(PICKED[0])).toBe(false);
    expect(ids.size).toBe(3);
  });

  it("清单最多带 300 个词进一场", () => {
    const many = Array.from({ length: 400 }, (_, index) => index + 1);
    expect(startPickedStudy(many).count).toBe(300);
  });

  it("不碰今日计划：勾中的词不会被塞进当日任务表", () => {
    startPickedStudy(PICKED);
    for (let index = 0; index < 10; index += 1) {
      const card = getWordSession(options).card;
      if (!card) break;
      submitWordAnswer(card.id, "know", options);
    }
    // 当日任务表本身会被正常流程建出来（任何一次取数都会排今天的计划），
    // 但勾中的这四个词（都排到 30 天后）一个也不该出现在里面。
    const inPlan = testDb.exec(
      `SELECT COUNT(*) FROM stage1_tasks WHERE word_id IN (${PICKED.join(",")})`
    )[0]?.values?.[0]?.[0] ?? 0;
    expect(Number(inPlan)).toBe(0);
  });
});
