/** 排查「上一个」(撤销)按钮:点了之后到底回没回到刚才那张卡 */
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
  continueKanjiStudy,
  continueStage2Study,
  continueTodayPlanStudy,
  ensureProgressInitialized,
  getWordSession,
  getWordStats,
  submitWordAnswer,
  undoLastWordAnswer
} from "./word-api";
import { saveStudyPreferences, defaultStudyPreferences } from "./studyPreferences";

const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

const seedSmallPlan = () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run("DELETE FROM stage2_progress");
  testDb.run("DELETE FROM kanji_progress");
  testDb.run("DELETE FROM kanji_reading_progress");
  testDb.run("DELETE FROM kanji_reading_memory");
  testDb.run("DELETE FROM reviews");
  testDb.run(`
    UPDATE progress SET
      seen_count = 5, known_forever = 0,
      right_count = 5, fuzzy_count = 0, forgot_count = 0,
      fsrs_stability = 8.0, fsrs_difficulty = 4.0, fsrs_state = 2,
      fsrs_reps = 5, fsrs_lapses = 0,
      fsrs_last_review = ?, fsrs_due = ?
    WHERE word_id <= 20
  `, [daysAgo(30), daysAgo(2)]);
};

const one = (sql: string, params: unknown[] = []) => {
  const result = testDb.exec(sql, params as never)[0];
  return result?.values?.[0]?.[0] ?? null;
};

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  prefStore.clear();
  saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 5, reviewCap: 20 });
  ensureProgressInitialized();
  seedSmallPlan();
  // 先让 stage1 计划版本号落定:否则第一次读统计会顺手把 current_card 清成 0,
  // 那是另一个坑(见 stage1.ts 的 resetUnansweredStage1PlanForVersion),不是本轮要测的。
  getWordStats();
});

describe("撤销上一次作答", () => {
  it("正向:撤销回到刚才那张,且状态放回作答前", () => {
    const first = continueTodayPlanStudy();
    const answered = first.card!.id;
    const seenBefore = Number(one("SELECT seen_count FROM progress WHERE word_id = ?", [answered]));
    const dueBefore = one("SELECT fsrs_due FROM progress WHERE word_id = ?", [answered]);

    submitWordAnswer(answered, "know");
    const undone = undoLastWordAnswer();

    expect(undone.card?.id).toBe(answered);
    expect(Number(one("SELECT seen_count FROM progress WHERE word_id = ?", [answered]))).toBe(seenBefore);
    expect(one("SELECT fsrs_due FROM progress WHERE word_id = ?", [answered])).toBe(dueBefore);
    expect(Number(one("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [answered]))).toBe(0);
  });

  it("正向:撤销之后再读一次 session,还是刚才那张(UI 任何刷新都不能把它冲掉)", () => {
    const first = continueTodayPlanStudy();
    const answered = first.card!.id;
    submitWordAnswer(answered, "know");
    undoLastWordAnswer();
    expect(getWordSession().card?.id).toBe(answered);
  });

  it("正向:答错之后撤销,也回到那张", () => {
    const first = continueTodayPlanStudy();
    const answered = first.card!.id;
    submitWordAnswer(answered, "forgot");
    expect(undoLastWordAnswer().card?.id).toBe(answered);
  });

  it("反向:撤销回到刚才那张", () => {
    const first = continueStage2Study();
    const answered = first.card!.id;
    submitWordAnswer(answered, "know");
    const undone = undoLastWordAnswer();
    expect(undone.phase).toBe("stage2");
    expect(undone.card?.id).toBe(answered);
    expect(getWordSession().card?.id).toBe(answered);
  });

  it("汉字:撤销回到刚才那张", () => {
    const first = continueKanjiStudy();
    const answered = first.card!.id;
    submitWordAnswer(answered, "know");
    const undone = undoLastWordAnswer();
    expect(undone.phase).toBe("kanji");
    expect(undone.card?.id).toBe(answered);
    expect(getWordSession().card?.id).toBe(answered);
  });

  it("只答过一次:撤完就没得撤了,再点停在原地并置灰", () => {
    const first = continueTodayPlanStudy();
    const answered = first.card!.id;
    submitWordAnswer(answered, "know");
    const once = undoLastWordAnswer();
    expect(once.card?.id).toBe(answered);
    expect(once.canUndo).toBe(false);

    const twice = undoLastWordAnswer();
    expect(twice.card?.id).toBe(answered);
    expect(twice.canUndo).toBe(false);
  });

  it("最多撤两次:答三张只能退回第二张,第三次点不动", () => {
    const ids: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const session = index === 0 ? continueTodayPlanStudy() : getWordSession();
      ids.push(session.card!.id);
      submitWordAnswer(session.card!.id, "know");
    }

    expect(undoLastWordAnswer().card?.id).toBe(ids[2]);
    const second = undoLastWordAnswer();
    expect(second.card?.id).toBe(ids[1]);
    expect(second.canUndo).toBe(false);
    // 第三次:栈空了,停在第二张不动,更不能去翻第一张的账
    const third = undoLastWordAnswer();
    expect(third.card?.id).toBe(ids[1]);
    expect(Number(one("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [ids[0]]))).toBe(1);
  });

  it("撤销把作答整个放回去:两张都不留流水,状态回到答之前", () => {
    const first = continueTodayPlanStudy();
    const a = first.card!.id;
    const dueA = one("SELECT fsrs_due FROM progress WHERE word_id = ?", [a]);
    submitWordAnswer(a, "know");
    const second = getWordSession();
    const b = second.card!.id;
    const dueB = one("SELECT fsrs_due FROM progress WHERE word_id = ?", [b]);
    submitWordAnswer(b, "forgot");

    undoLastWordAnswer();
    undoLastWordAnswer();

    expect(one("SELECT fsrs_due FROM progress WHERE word_id = ?", [b])).toBe(dueB);
    expect(one("SELECT fsrs_due FROM progress WHERE word_id = ?", [a])).toBe(dueA);
    expect(Number(one("SELECT COUNT(*) FROM reviews"))).toBe(0);
  });

  it("错题本:撤销回到刚才那张,而且不掉出错题本", () => {
    const mistakes = { focus: "mistakes" as const };
    testDb.run(`
      UPDATE progress SET fsrs_lapses = 4, forgot_count = 4, seen_count = 12
      WHERE word_id <= 20
    `);
    const first = getWordSession(mistakes);
    expect(first.phase).toBe("mistakes");
    const answered = first.card!.id;
    submitWordAnswer(answered, "know", mistakes);
    const undone = undoLastWordAnswer(mistakes);
    expect(undone.phase).toBe("mistakes");
    expect(undone.card?.id).toBe(answered);
  });

  it("错题本:没得撤销时不该把用户甩回今日计划", () => {
    const mistakes = { focus: "mistakes" as const };
    testDb.run(`
      UPDATE progress SET fsrs_lapses = 4, forgot_count = 4, seen_count = 12
      WHERE word_id <= 20
    `);
    getWordSession(mistakes);
    expect(undoLastWordAnswer(mistakes).phase).toBe("mistakes");
  });

  it("换了模式再点撤销:不该把上个模式的词拽过来,也不该把当前模式踢掉", () => {
    const forward = continueTodayPlanStudy();
    const forwardWord = forward.card!.id;
    submitWordAnswer(forwardWord, "know");

    // 用户切到反向,第一张还没答就点了「上一个」
    const reverse = continueStage2Study();
    const reverseWord = reverse.card!.id;
    const undone = undoLastWordAnswer();
    expect(undone.phase).toBe("stage2");
    expect(undone.card?.id).toBe(reverseWord);
    expect(undone.canUndo).toBe(false);
    // 正向那次作答一动不动:它不属于这一场
    expect(Number(one(
      "SELECT COUNT(*) FROM reviews WHERE word_id = ? AND direction = 'forward'",
      [forwardWord]
    ))).toBe(1);
  });

  it("隔了一天再点撤销:不该翻出昨天那条账", () => {
    const first = continueTodayPlanStudy();
    const answered = first.card!.id;
    submitWordAnswer(answered, "know");
    // 快照改成昨天那一场留下的:用户昨天答完关掉,今天开机第一件事就点了「上一个」
    const stack = JSON.parse(String(one("SELECT value FROM app_state WHERE key = 'last_answer'")));
    stack.forEach((item: Record<string, unknown>) => { item.reviewed_on = "2000-01-01"; });
    testDb.run("UPDATE app_state SET value = ? WHERE key = 'last_answer'", [JSON.stringify(stack)]);
    const dueAfterAnswer = one("SELECT fsrs_due FROM progress WHERE word_id = ?", [answered]);

    const undone = undoLastWordAnswer();
    expect(undone.canUndo).toBe(false);
    expect(one("SELECT fsrs_due FROM progress WHERE word_id = ?", [answered])).toBe(dueAfterAnswer);
    expect(Number(one("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [answered]))).toBe(1);
  });

  it("老格式的单条快照(升级前留下的)不该被翻出来改数据", () => {
    const first = continueTodayPlanStudy();
    const answered = first.card!.id;
    submitWordAnswer(answered, "know");
    const legacy = JSON.parse(String(one("SELECT value FROM app_state WHERE key = 'last_answer'")))[0];
    delete legacy.mode;
    delete legacy.reviewed_on;
    testDb.run("UPDATE app_state SET value = ? WHERE key = 'last_answer'", [JSON.stringify(legacy)]);

    expect(undoLastWordAnswer().canUndo).toBe(false);
    expect(Number(one("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [answered]))).toBe(1);
  });

  it("答第二张之后撤销,回到第二张(不是第一张)", () => {
    const first = continueTodayPlanStudy();
    const a = first.card!.id;
    submitWordAnswer(a, "know");
    const second = getWordSession();
    const b = second.card!.id;
    expect(b).not.toBe(a);
    submitWordAnswer(b, "know");
    expect(undoLastWordAnswer().card?.id).toBe(b);
  });
});
