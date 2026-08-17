/**
 * FSRS-only 端到端:getWordSession 的当日复习任务应来自 FSRS 到期集合。
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
import { recordReview, type FsrsState } from "./fsrs-scheduler";
import { STUBBORN_MISTAKE_STREAK } from "./scheduler/requeue";
import { studyDayEnd, getState, setState } from "./database/db-utils";

describe("FSRS-only · 端到端选词", () => {
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

  it("复习任务只含 FSRS 到期词,未到期词被排除", () => {
    getWordSession();
    const tasks = testDb.exec("SELECT word_id FROM stage1_tasks WHERE task_type='review'")[0]?.values.map((v) => Number(v[0])) ?? [];
    expect(tasks).toContain(500);        // 已过期 → 入选
    expect(tasks).toContain(502);        // 未调度 → 入选
    expect(tasks).not.toContain(501);    // 未到期 → 不入选
  });

  it("集成:点服务出的卡『不认识』→ 当天不毕业(会再出),不是消失", () => {
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
  });

  it("集成:点『不认识』后不贴脸重复——下一张必是别的词,且要隔好几张才回来", () => {
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("DELETE FROM reviews");
    testDb.run("UPDATE progress SET seen_count=3, score=12, mistake_streak=0, fsrs_stability=NULL, fsrs_due=NULL, fsrs_state=NULL WHERE word_id BETWEEN 1 AND 40 AND known_forever=0");

    const forgotten = getWordSession().card!;
    submitWordAnswer(forgotten.id, "forgot");

    // 刚看完答案立刻再考 = 抄写,不是回忆:下一张绝不能还是它
    let gap = 0;
    let card = getWordSession().card;
    while (card && card.id !== forgotten.id && gap < 40) {
      gap += 1;
      submitWordAnswer(card.id, "know");
      card = getWordSession().card;
    }
    expect(card?.id).toBe(forgotten.id);   // 确实回来了(没毕业,当天还要刷)
    expect(gap).toBeGreaterThanOrEqual(3); // 但至少隔了 3 张(SHORT_STEP_GAP 下限)
  });

  it("集成:顽固词(连着错到阈值)可以连出,当场刷到答对", () => {
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("DELETE FROM reviews");
    testDb.run("UPDATE progress SET seen_count=3, score=12, mistake_streak=0, fsrs_stability=NULL, fsrs_due=NULL, fsrs_state=NULL WHERE word_id BETWEEN 1 AND 40 AND known_forever=0");
    const rand = vi.spyOn(Math, "random").mockReturnValue(0.999); // 固定成「本轮不插新词」,只看旧词

    const card = getWordSession().card!;
    // 让这一答正好踩到顽固阈值
    testDb.run(`UPDATE progress SET mistake_streak=${STUBBORN_MISTAKE_STREAK - 1} WHERE word_id=${card.id}`);
    submitWordAnswer(card.id, "forgot");

    expect(getWordSession().card?.id).toBe(card.id); // 顽固词:下一张就是它,不再拉开

    rand.mockRestore();
  });

  it("当天第一次认识的奖励不看 FSRS 历史,也不看 seen_count", () => {
    // 「一键完成」等快捷通道可能把 seen_count 加过,但当天第一次真正作答仍应享受奖励。
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("DELETE FROM reviews");
    testDb.run("UPDATE progress SET seen_count=0, mistake_streak=0, fsrs_stability=NULL, fsrs_due=NULL, fsrs_state=NULL WHERE known_forever=0");

    // 必须让它真的把卡服务出来,否则 claimCurrentCard 会把这次作答当成过期提交丢掉
    const card = getWordSession().card!;
    // 服务出来之后再把 seen_count 顶上去 = 模拟「一键完成」留下的虚增值
    testDb.run(`UPDATE progress SET seen_count = 2 WHERE word_id = ${card.id}`);
    submitWordAnswer(card.id, "know");

    const row = testDb.exec(`SELECT fsrs_state, fsrs_due FROM progress WHERE word_id=${card.id}`)[0].values[0];
    expect(Number(row[0])).toBe(2);                                                      // Review,不是 Learning(1)
    expect(new Date(String(row[1])).getTime()).toBeGreaterThan(studyDayEnd().getTime()); // 已毕业,当天不再出
  });

  it("已有 FSRS 历史的词,当天第一次点认识也按 Easy 奖励", () => {
    testDb.run("DELETE FROM stage1_tasks");
    testDb.run("DELETE FROM reviews");
    setState("review_queue", "[]");
    testDb.run("UPDATE progress SET known_forever=1 WHERE word_id != 1");

    const now = new Date();
    const previousReview = new Date(now.getTime() - 2 * 86400000);
    const previousDue = new Date(now.getTime() - 86400000);
    const previous: FsrsState = {
      stability: 10,
      difficulty: 5,
      due: previousDue.toISOString(),
      lastReview: previousReview.toISOString(),
      state: 2,
      steps: 0,
      reps: 3,
      lapses: 0
    };
    testDb.run(`
      UPDATE progress
      SET known_forever=0, seen_count=3,
          fsrs_stability=?, fsrs_difficulty=?, fsrs_last_review=?, fsrs_due=?,
          fsrs_state=?, fsrs_steps=?, fsrs_reps=?, fsrs_lapses=?
      WHERE word_id=1
    `, [
      previous.stability,
      previous.difficulty,
      previous.lastReview,
      previous.due,
      previous.state,
      previous.steps,
      previous.reps,
      previous.lapses
    ]);

    const expected = recordReview(previous, "know", now, { mode: "known" });
    const normal = recordReview(previous, "know", now, { mode: "normal" });
    const card = getWordSession().card!;
    expect(card.id).toBe(1);
    submitWordAnswer(card.id, "know");

    const row = testDb.exec("SELECT fsrs_stability, fsrs_due FROM progress WHERE word_id=1")[0].values[0];
    expect(Number(row[0])).toBeCloseTo(expected.stability, 5);
    expect(String(row[1])).toBe(expected.due);
    expect(new Date(expected.due).getTime()).toBeGreaterThan(new Date(normal.due).getTime());
    expect(new Date(String(row[1])).getTime()).toBeGreaterThan(studyDayEnd().getTime());
  });
});
