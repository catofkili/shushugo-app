/**
 * FSRS 切换端到端:开关打开后,getWordSession 的当日复习任务应来自 FSRS 到期集合。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => prefStore.get(k) ?? null,
  setItem: (k: string, v: string) => { prefStore.set(k, String(v)); },
  removeItem: (k: string) => { prefStore.delete(k); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };

vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb, exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import { ensureProgressInitialized, getWordSession, submitWordAnswer } from "./word-api";
import { setFsrsActive } from "./fsrs-store";
import { studyDayEnd, getState } from "./database/db-utils";

describe("FSRS 切换 · 端到端选词", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const noon = new Date(); noon.setHours(12, 0, 0, 0); vi.setSystemTime(noon);
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    ensureProgressInitialized();

    const cols = testDb.exec("PRAGMA table_info(reviews)")[0]?.values.map((v) => v[1]) ?? [];
    if (!cols.includes("created_at")) testDb.run("ALTER TABLE reviews ADD COLUMN created_at TEXT");
    testDb.run("DELETE FROM reviews");
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("UPDATE progress SET seen_count = 0, score = 0, known_forever = 0, fsrs_stability=NULL, fsrs_due=NULL");

    // 30 个已见词;给三个受控 FSRS 状态,其余留待回填
    const due = new Date(Date.now() - 5 * 86400000).toISOString();
    const future = new Date(Date.now() + 20 * 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    testDb.run("UPDATE progress SET seen_count = 3, score = 12 WHERE word_id <= 30");
    // 500 = 已过期该复习;501 = 未到期不该出现;502 = 已见未调度(应最优先)
    testDb.run(`UPDATE progress SET seen_count=3, score=12, fsrs_stability=10, fsrs_difficulty=5, fsrs_last_review='${past}', fsrs_due='${due}' WHERE word_id=500`);
    testDb.run(`UPDATE progress SET seen_count=3, score=12, fsrs_stability=40, fsrs_difficulty=5, fsrs_last_review='${past}', fsrs_due='${future}' WHERE word_id=501`);
    testDb.run(`UPDATE progress SET seen_count=3, score=12, fsrs_stability=NULL, fsrs_due=NULL WHERE word_id=502`);
  });

  afterAll(() => vi.useRealTimers());

  it("开关打开:复习任务只含 FSRS 到期词,未到期词被排除", () => {
    setFsrsActive(true);
    getWordSession();
    const tasks = testDb.exec("SELECT word_id FROM stage1_tasks WHERE task_type='review'")[0]?.values.map((v) => Number(v[0])) ?? [];
    expect(tasks).toContain(500);        // 已过期 → 入选
    expect(tasks).toContain(502);        // 未调度 → 入选
    expect(tasks).not.toContain(501);    // 未到期 → 不入选
    setFsrsActive(false);
  });

  it("集成:点服务出的卡『不认识』→ 当天不毕业(会再出),不是消失", () => {
    setFsrsActive(true);
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("DELETE FROM reviews");
    testDb.run("UPDATE progress SET seen_count=3, score=12, fsrs_stability=NULL, fsrs_due=NULL, fsrs_state=NULL WHERE word_id BETWEEN 1 AND 20 AND known_forever=0");

    const card = getWordSession().card;        // 服务出当前卡
    expect(card).not.toBeNull();
    submitWordAnswer(card!.id, "forgot");

    const due = testDb.exec(`SELECT fsrs_due FROM progress WHERE word_id=${card!.id}`)[0].values[0][0] as string | null;
    expect(due).toBeTruthy();                                                  // FSRS 记录已写(每次作答都记)
    expect(new Date(due!).getTime()).toBeLessThanOrEqual(studyDayEnd().getTime()); // due 落在今天 = 没毕业 = 会再出,不是消失
    const q = JSON.parse(getState("review_queue", "[]")) as any[];
    expect(q.some((x) => x.word_id === card!.id)).toBe(true);                  // 已排回队列,过几张卡再刷
    setFsrsActive(false);
  });

  it("开关关闭:回到现行分数选词(不受 fsrs_due 影响)", () => {
    testDb.run("DELETE FROM stage1_tasks");
    // 501 未到期但分数低 → 关闭时应能入选(证明走的是分数路径)
    testDb.run("UPDATE progress SET score = 0 WHERE word_id = 501");
    setFsrsActive(false);
    getWordSession();
    const tasks = testDb.exec("SELECT word_id FROM stage1_tasks WHERE task_type='review'")[0]?.values.map((v) => Number(v[0])) ?? [];
    expect(tasks).toContain(501); // 分数路径按 score≤6 选,与 fsrs_due 无关
  });
});
