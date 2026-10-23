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
import { setState, studyDayEnd, today } from "../study-core";
import { advanceDailyRelief, ensureDailyRelief, getDailyReliefNext } from "./daily-relief";
import { advanceDailyTail, ensureDailyTail, getDailyTailNext, getDailyTailProgress, rewindDailyTail } from "./daily-tail";
import { dailyReviewBatch, dailyReviewCandidateCount, getDailyReviewCard, shouldInviteDailyReview, declineDailyReviewInvite, startDailyReviewRound } from "./daily-review";
import { STAGE1_PLAN_VERSION } from "./stage1";
import { getWordStats } from "./stats";
import { continueTodayPlanStudy, submitWordAnswer } from "../word-api";
import { answerDailyReviewRound, createDailyReviewRound, roundWritesFsrs } from "./daily-review-round";

const day = "2026-08-03";
const yesterday = "2026-08-02";

const clearFlowState = () => {
  testDb.run("DELETE FROM reviews");
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run("DELETE FROM app_state WHERE key IN ('daily_relief_v1', 'daily_relief_v2', 'daily_tail_v1', 'daily_tail_v2', 'daily_review_v2')");
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

    // 日历 / 完成页那格和小路同一口径:减负 + 单词 + 语法。往日的减负按当天判据重算。
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (1, 'know', 0, ?, 'forward')", [day]);
    testDb.run("INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on) VALUES (1, 'know', 0, ?)", [day]);
    testDb.run("INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on) VALUES (1, 'forgot', 0, ?)", [day]);
    const byDate = new Map(getWordStats().dailyStudyStats.map((item) => [item.date, item]));
    expect(byDate.get(day)).toMatchObject({ wordCount: 1, grammarCount: 1, reliefCount: 1, total: 3 });
    // 昨天答了 100 个词,但前天没学 → 昨天没有减负
    expect(byDate.get(yesterday)).toMatchObject({ wordCount: 100, grammarCount: 0, reliefCount: 0, total: 100 });
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

  const addAnswers = (count: number, answer = "know", wordId = 1) => {
    for (let repeat = 0; repeat < count; repeat += 1) {
      testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, ?, 0, ?, 'forward')", [wordId, answer, day]);
    }
  };
  const reviewCandidates = (count = 5) => {
    for (let id = 1; id <= count; id += 1) {
      testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, 'review', ?)", [day, id, id]);
      testDb.run("UPDATE progress SET known_forever = 0, fsrs_due = ? WHERE word_id = ?", [studyDayEnd().toISOString(), id]);
      addAnswers(3, "fuzzy", id);
    }
  };

  it("候选少于五个不邀请", () => {
    reviewCandidates(4);
    expect(shouldInviteDailyReview()).toBe(false);
  });
  it("五个候选即邀请，不要求完成度窗口或刚答忘记", () => {
    reviewCandidates();
    expect(shouldInviteDailyReview()).toBe(true);
    expect(dailyReviewCandidateCount()).toBe(5);
  });
  it("候选只数今天计划中正向三次且未过的词，批次按原排序最多八个", () => {
    reviewCandidates(11);
    testDb.run("DELETE FROM reviews WHERE word_id = 1");
    addAnswers(2, "fuzzy", 1);
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (1, 'know', 0, ?, 'reverse')", [day]);
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id = 2");
    testDb.run("UPDATE progress SET fsrs_due = '2026-08-10T12:00:00.000Z' WHERE word_id = 3");
    testDb.run("DELETE FROM stage1_tasks WHERE word_id = 4");
    expect(dailyReviewBatch().map((word) => word.id)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    testDb.run("UPDATE progress SET known_forever = 0 WHERE word_id = 2");
    testDb.run("UPDATE progress SET fsrs_due = NULL WHERE word_id = 3");
    expect(dailyReviewBatch()).toHaveLength(8);
    expect(getDailyReviewCard(5)?.id).toBe(5);
    expect(getDailyReviewCard(-1)).toBeNull();
  });
  it("疲劳时不邀请", () => {
    reviewCandidates();
    addAnswers(30);
    addAnswers(20, "forgot");
    expect(shouldInviteDailyReview()).toBe(false);
  });
  it("一天第三轮不再邀请", () => {
    reviewCandidates();
    startDailyReviewRound();
    addAnswers(30);
    expect(shouldInviteDailyReview()).toBe(true);
    startDailyReviewRound();
    addAnswers(30);
    expect(shouldInviteDailyReview()).toBe(false);
  });
  it("第二轮距离开局不足三十题不邀请，满三十题可邀请", () => {
    reviewCandidates();
    startDailyReviewRound();
    addAnswers(29);
    expect(shouldInviteDailyReview()).toBe(false);
    addAnswers(1);
    expect(shouldInviteDailyReview()).toBe(true);
  });
  it("拒绝一次后二十题内不邀请，满二十题可邀请", () => {
    reviewCandidates();
    declineDailyReviewInvite();
    addAnswers(19);
    expect(shouldInviteDailyReview()).toBe(false);
    addAnswers(1);
    expect(shouldInviteDailyReview()).toBe(true);
  });
  it("拒绝两次后当天不再邀请", () => {
    reviewCandidates();
    declineDailyReviewInvite();
    addAnswers(20);
    declineDailyReviewInvite();
    addAnswers(100);
    expect(shouldInviteDailyReview()).toBe(false);
  });
  it("跨日丢弃轮数和拒绝记录，开始一轮会清掉邀请计数和暂缓", () => {
    reviewCandidates();
    setState("daily_review_v2", JSON.stringify({ studyDate: yesterday, declined: true, rounds: 2 }));
    expect(shouldInviteDailyReview()).toBe(true);
    declineDailyReviewInvite();
    startDailyReviewRound();
    const state = JSON.parse(String(testDb.exec("SELECT value FROM app_state WHERE key = 'daily_review_v2'")[0].values[0][0]));
    expect(state).toMatchObject({ studyDate: day, rounds: 1, invites: 0, snoozeUntilAnswerCount: 0, lastRoundAnswerCount: 15 });
  });

  it("轮内正式作答仍写 FSRS，复查不写库，复查错后下一次重新记账", () => {
    reviewCandidates();
    setState("current_card", "2");
    let round = createDailyReviewRound([1, 2, 3, 4, 5]);
    const answerRound = (good: boolean) => {
      if (roundWritesFsrs(round, 1)) submitWordAnswer(1, good ? "know" : "forgot", {}, false, true);
      round = answerDailyReviewRound(round, 1, good);
    };
    answerRound(true);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM reviews WHERE word_id = 1")[0].values[0][0])).toBe(4);
    const before = testDb.exec("SELECT total_changes()")[0].values[0][0];
    answerRound(false);
    expect(testDb.exec("SELECT total_changes()")[0].values[0][0]).toBe(before);
    answerRound(true);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM reviews WHERE word_id = 1")[0].values[0][0])).toBe(5);
    const after = testDb.exec("SELECT total_changes()")[0].values[0][0];
    answerRound(true);
    expect(testDb.exec("SELECT total_changes()")[0].values[0][0]).toBe(after);
    expect(round.words[0].status).toBe("done");
  });
  it("退出回顾恢复仍合法的原卡，已毕业或不在今日计划的原卡重新选", () => {
    reviewCandidates();
    expect(continueTodayPlanStudy(5).card?.id).toBe(5);
    expect(String(testDb.exec("SELECT value FROM app_state WHERE key = 'current_card'")[0].values[0][0])).toBe("5");
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id = 5");
    expect(continueTodayPlanStudy(5).card?.id).not.toBe(5);
    expect(continueTodayPlanStudy(100).card?.id).not.toBe(100);
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
