/**
 * 混合模式（单词 + 语法）的「上一个」。
 *
 * 单词和语法各有一份**互相不知道对方存在**的撤销栈（`last_answer` /
 * `quiz_undo:<等级>`）。上线时学习页的「上一个」只调 `undoLastWordAnswer`，
 * 于是答完一条语法再点它，撤掉的是**语法之前那个单词**：语法留下一次不该留的
 * 作答（FSRS 已推进、流水已写），单词丢掉一次该留的。一次误操作造两笔假数据。
 *
 * 这里钉的是学习页依赖的那条契约：**按作答顺序分派，两侧各自完整回滚、互不牵连。**
 * ⚠️ 分派本身写在 `WordStudy.tsx`（undoKindsRef），仓库里没有 testing-library，
 * 这个测试跑的是它调用的那两个函数，覆盖不到组件的接线。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
(globalThis as any).window = {
  dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined
};
vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined, persistSoon: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import {
  continueTodayPlanStudy, ensureProgressInitialized, getWordStats,
  submitWordAnswer, undoLastWordAnswer
} from "./word-api";
import { getGrammarQuizSession, submitGrammarQuizAnswer, undoLastGrammarQuizAnswer } from "./grammar-quiz";
import { saveStudyPreferences, defaultStudyPreferences } from "./studyPreferences";

const SQL = await initSqlJs();
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const LEVEL = "N5";

const one = (sql: string, p: unknown[] = []) => testDb.exec(sql, p as never)[0]?.values?.[0]?.[0] ?? null;
const wordState = (id: number) =>
  one("SELECT fsrs_due || '|' || seen_count || '|' || right_count FROM progress WHERE word_id = ?", [id]);
const grammarState = (id: number) =>
  one("SELECT COALESCE(fsrs_due,'') || '|' || seen_count || '|' || right_count FROM grammar_progress WHERE grammar_id = ?", [id]);

/** 学习页那份分派的最小复刻：按作答顺序记类型，撤销时看栈顶是哪一边。 */
const makeSession = () => {
  const kinds: ("word" | "grammar")[] = [];
  return {
    answerWord(id: number) { submitWordAnswer(id, "know"); kinds.push("word"); },
    answerGrammar(id: number) { submitGrammarQuizAnswer(LEVEL, id, "know"); kinds.push("grammar"); },
    undo() {
      if (kinds.pop() === "grammar") undoLastGrammarQuizAnswer(LEVEL);
      else undoLastWordAnswer({});
    }
  };
};

beforeEach(() => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  prefStore.clear();
  saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 5, reviewCap: 20 });
  ensureProgressInitialized();
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run("DELETE FROM reviews");
  testDb.run(`UPDATE progress SET seen_count = 5, known_forever = 0, right_count = 5,
    fsrs_stability = 8.0, fsrs_difficulty = 4.0, fsrs_state = 2, fsrs_reps = 5, fsrs_lapses = 0,
    fsrs_last_review = ?, fsrs_due = ? WHERE word_id <= 20`, [daysAgo(30), daysAgo(2)]);
  getWordStats();
});

describe("混合模式的「上一个」", () => {
  it("答完语法再撤销:撤的是那条语法,不是语法之前那个单词", () => {
    const session = makeSession();
    const w = continueTodayPlanStudy().card!;
    const g = getGrammarQuizSession(LEVEL).card!;
    const gBefore = grammarState(g.id);

    session.answerWord(w.id);
    const wAfterAnswer = wordState(w.id);
    session.answerGrammar(g.id);
    expect(grammarState(g.id)).not.toBe(gBefore);

    session.undo();

    // 语法整个退回:FSRS、计数、流水
    expect(grammarState(g.id)).toBe(gBefore);
    expect(one("SELECT COUNT(*) FROM grammar_reviews WHERE grammar_id = ?", [g.id])).toBe(0);
    // 单词那次原封不动 —— 用户撤的不是它
    expect(wordState(w.id)).toBe(wAfterAnswer);
    expect(one("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [w.id])).toBe(1);
  });

  it("再撤一次才轮到单词,同样整个退回", () => {
    const session = makeSession();
    const w = continueTodayPlanStudy().card!;
    const g = getGrammarQuizSession(LEVEL).card!;
    const wBefore = wordState(w.id);

    session.answerWord(w.id);
    session.answerGrammar(g.id);
    session.undo();
    session.undo();

    expect(wordState(w.id)).toBe(wBefore);
    expect(one("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [w.id])).toBe(0);
  });

  it("语法-单词-语法交替着答,倒着撤销能一路回到起点", () => {
    const session = makeSession();
    const w = continueTodayPlanStudy().card!;
    const g = getGrammarQuizSession(LEVEL).card!;
    const wBefore = wordState(w.id);
    const gBefore = grammarState(g.id);

    session.answerGrammar(g.id);
    session.answerWord(w.id);
    session.undo();
    session.undo();

    expect(wordState(w.id)).toBe(wBefore);
    expect(grammarState(g.id)).toBe(gBefore);
    expect(one("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [w.id])).toBe(0);
    expect(one("SELECT COUNT(*) FROM grammar_reviews WHERE grammar_id = ?", [g.id])).toBe(0);
  });

  it("撤销语法不消耗单词那份撤销栈(反过来也一样)", () => {
    const session = makeSession();
    const w = continueTodayPlanStudy().card!;
    const g = getGrammarQuizSession(LEVEL).card!;
    const wBefore = wordState(w.id);

    session.answerWord(w.id);
    session.answerGrammar(g.id);
    session.undo();                       // 撤语法
    // 单词那笔还在栈上:这一下必须真的把它撤掉
    expect(undoLastWordAnswer({}).card?.id).toBe(w.id);
    expect(wordState(w.id)).toBe(wBefore);
  });
});
