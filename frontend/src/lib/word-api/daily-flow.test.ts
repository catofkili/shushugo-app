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
import { advanceDailyTail, ensureDailyTail, getDailyTailNext, getDailyTailProgress, rewindDailyTail } from "./daily-tail";
import { pickDailyReviewNext, shouldStartDailyReview } from "./daily-review";
import { STAGE1_PLAN_VERSION } from "./stage1";
import { getWordStats } from "./stats";

const day = "2026-08-03";
const yesterday = "2026-08-02";

const clearFlowState = () => {
  testDb.run("DELETE FROM reviews");
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run("DELETE FROM app_state WHERE key IN ('daily_relief_v1', 'daily_relief_v2', 'daily_tail_v1', 'daily_tail_v2', 'daily_review_v1')");
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
    // 额外的模糊词只用于证明「昨天确实学了 100 个去重词」,不能成为减负候选。
    for (let wordId = 14; wordId <= 106; wordId += 1) {
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'fuzzy', 0, ?, 'forward')",
        [wordId, yesterday]
      );
    }

    const state = ensureDailyRelief();
    expect(state.wordIds).toEqual([2, 3, 4, 5, 6, 7]);
    expect(getDailyReliefNext()?.id).toBe(2);
    const progressBefore = testDb.exec(
      "SELECT seen_count, known_forever, fsrs_stability, fsrs_difficulty, fsrs_due, fsrs_state, fsrs_steps, fsrs_reps, fsrs_lapses FROM progress WHERE word_id = 2"
    )[0].values[0];
    const before = getWordStats();
    expect(before.stage1ProgressTotal).toBe(7 + state.wordIds.length);
    expect(before.stage1ProgressDone).toBe(7);
    advanceDailyRelief();
    expect(getDailyReliefNext()?.id).toBe(3);
    const after = getWordStats();
    expect(after.stage1ProgressTotal).toBe(7 + state.wordIds.length);
    expect(after.stage1ProgressDone).toBe(8);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM reviews")[0].values[0][0])).toBe(115);
    expect(testDb.exec(
      "SELECT seen_count, known_forever, fsrs_stability, fsrs_difficulty, fsrs_due, fsrs_state, fsrs_steps, fsrs_reps, fsrs_lapses FROM progress WHERE word_id = 2"
    )[0].values[0]).toEqual(progressBefore);
    // 减负只清后台奖励卡,今日计划(包括新词)一张都不能被删。
    expect(Number(testDb.exec("SELECT COUNT(*) FROM stage1_tasks")[0].values[0][0])).toBe(7);
  });

  it("前一天学得越多才逐步增加减负,100个不是12个,300个才到12个", () => {
    for (let wordId = 1; wordId <= 12; wordId += 1) {
      makeFutureWord(wordId);
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'know', 0, ?, 'forward')",
        [wordId, yesterday]
      );
    }
    for (let wordId = 13; wordId <= 100; wordId += 1) {
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'fuzzy', 0, ?, 'forward')",
        [wordId, yesterday]
      );
    }
    expect(ensureDailyRelief().wordIds).toHaveLength(6);

    testDb.run("DELETE FROM app_state WHERE key = 'daily_relief_v2'");
    for (let wordId = 101; wordId <= 300; wordId += 1) {
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'fuzzy', 0, ?, 'forward')",
        [wordId, yesterday]
      );
    }
    expect(ensureDailyRelief().wordIds).toHaveLength(12);
  });

  it("前一天没有学习时不生成减负,更早日期的记录也不能冒充昨天", () => {
    for (let wordId = 1; wordId <= 12; wordId += 1) {
      makeFutureWord(wordId);
      testDb.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'know', 0, ?, 'forward')",
        [wordId, "2026-08-01"]
      );
    }
    expect(ensureDailyRelief().wordIds).toEqual([]);
    expect(getDailyReliefNext()).toBeNull();
  });

  it("60%-80%只上膛,要等下一次「忘记」才开回顾区", () => {
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
    // 完成度进了窗口,但这一下是「认识」—— 只上膛,不开火。
    expect(shouldStartDailyReview(false)).toBe(false);
    expect(shouldStartDailyReview(true)).toBe(true);
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
    expect(shouldStartDailyReview(true)).toBe(false);
  });

  it("上了膛就一直算数:完成度被答对推过80%之后,那次「忘记」照样开回顾区", () => {
    // 25 张任务:21 张普通 + 4 张「今天已经答过四次还没清掉」的候选
    for (let wordId = 1; wordId <= 25; wordId += 1) {
      testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, 'review', ?)", [day, wordId, wordId]);
    }
    testDb.run("UPDATE progress SET known_forever = 0 WHERE word_id <= 25");
    for (let wordId = 22; wordId <= 25; wordId += 1) {
      testDb.run("UPDATE progress SET known_forever = 0, seen_count = 8, fsrs_due = ? WHERE word_id = ?", [studyDayEnd().toISOString(), wordId]);
      for (let repeat = 0; repeat < 4; repeat += 1) {
        testDb.run(
          "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'forgot', 0, ?, 'forward')",
          [wordId, day]
        );
      }
    }
    // 15/25 = 60% —— 进窗口,但这一下是答对,只上膛
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id <= 15");
    expect(shouldStartDailyReview(false)).toBe(false);
    // 又答对 6 张:21/25 = 84%,完成度已经走出窗口,而膛里那发还在
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id <= 21");
    expect(shouldStartDailyReview(true)).toBe(true);
    expect(pickDailyReviewNext()?.id).toBe(22);
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

  // ⚠️ 压轴卡按「记得牢」挑,不按「此刻回忆概率高」挑。recall 是「距上次复习多久/稳定性」
  // 的函数,刚答过的卡恒等于 1 —— 老判据于是专挑今天刚复习过、因为老记不住才复习得勤的词
  // （实测用户当天的压轴七张里有四张稳定性不到 4 天,最差的 0.57 天、忘过 11 次）。
  it("压轴不收稳定性低的词,也不收今天已经答过的", () => {
    for (let wordId = 1; wordId <= 8; wordId += 1) makeFutureWord(wordId);
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id = 1");
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, 1, 'review', 1)", [day]);
    // 2: 刚答过、明天以后才到期,但稳定性只有 0.6 天 —— recall 接近 1,照样不该来收尾
    testDb.run(`
      UPDATE progress SET fsrs_stability = 0.6, fsrs_lapses = 4, seen_count = 30,
        fsrs_due = '2026-08-06T04:00:00.000Z', fsrs_last_review = ?
      WHERE word_id = 2
    `, [new Date().toISOString()]);
    // 3: 稳定性够,但今天已经答过一遍了 —— 那不是「再确认一次」
    testDb.run(
      "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (3, 'know', 0, ?, 'forward')",
      [day]
    );

    const state = ensureDailyTail();
    expect(state.wordIds).not.toContain(2);
    expect(state.wordIds).not.toContain(3);
    expect(state.wordIds.length).toBeGreaterThanOrEqual(3);
  });

  // 压轴卡走的是正式 FSRS：答错了那一下已经写进库,界面上却让它当场消失、
  // 直接进完成页,就是「说好再确认一次却没确认」。
  it("压轴卡答错会挪到队尾重来,最多重来两次", () => {
    for (let wordId = 1; wordId <= 6; wordId += 1) makeFutureWord(wordId);
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id = 1");
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, 1, 'review', 1)", [day]);
    const state = ensureDailyTail();
    const first = state.wordIds[0];

    advanceDailyTail({ requeue: true });
    expect(getDailyTailProgress().total).toBe(state.wordIds.length + 1);
    // 队尾那份就是它自己,轮完一圈还会再见到
    const afterSecond = advanceDailyTail({ requeue: false }).wordIds;
    expect(afterSecond[afterSecond.length - 1]).toBe(first);

    // 同一张最多出现三次:第三次答错不再往队尾排
    const beforeCap = { studyDate: day, wordIds: [first, first, first], completed: 2 };
    testDb.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('daily_tail_v2', ?)", [JSON.stringify(beforeCap)]);
    expect(advanceDailyTail({ requeue: true }).wordIds.length).toBe(3);

    // 答对不重排
    const clean = { studyDate: day, wordIds: [first, 2], completed: 0 };
    testDb.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('daily_tail_v2', ?)", [JSON.stringify(clean)]);
    expect(advanceDailyTail().wordIds).toEqual([first, 2]);
  });

  // 「上一个」要把队列一起退回去,否则撤销之后下一张会跳过一个词。
  it("撤销压轴卡会连重排的那一份一起退回去", () => {
    const state = { studyDate: day, wordIds: [11, 12], completed: 0 };
    testDb.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('daily_tail_v2', ?)", [JSON.stringify(state)]);

    advanceDailyTail({ requeue: true });   // 11 答错 → [11,12,11], completed=1
    expect(getDailyTailProgress()).toEqual({ total: 3, completed: 1, pending: 2 });

    rewindDailyTail(11);
    expect(getDailyTailProgress()).toEqual({ total: 2, completed: 0, pending: 2 });

    advanceDailyTail();                    // 11 答对 → completed=1
    rewindDailyTail(11);                   // 撤销:只退指针,不删任何一份
    expect(getDailyTailProgress()).toEqual({ total: 2, completed: 0, pending: 2 });
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
