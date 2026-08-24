/**
 * 三个方向(正向 / 反向 / 汉字)是三张**平级**的卡:各有自己的一份 FSRS 状态,
 * 规则完全一样,谁也不特别。这一份测试盯的就是「共通」和「互不干扰」这两件事。
 *
 * 以前:反向只有当天的 stage2_progress(关掉应用就没了)、按 temp_score ≥ 10 算过关、
 * 没有每日上限、不记流水;而且每答一个正向词就往反向队列插一条,今日计划一做完
 * 就被塞上同样数量的反向题。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  addWordToTodayEncore,
  ensureProgressInitialized,
  getWordSession,
  getWordStats,
  getQuickStudySession,
  submitKanjiUnitAnswer,
  submitWordAnswer
} from "./word-api";
import { setKanjiUnitSchedulerEnabled } from "./kanji-unit-scheduler";
import { loadKanjiUnitIndex } from "./kanji-unit-index";

// 运行时索引是动态 import 的,单位路径的用例必须先等它到位
beforeAll(async () => { await loadKanjiUnitIndex(); });
import { SEEDED_STABILITY_RATIO } from "./word-api/directions";
import { saveStudyPreferences, defaultStudyPreferences } from "./studyPreferences";
import { today } from "./study-core";

const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

/** 一小份今日计划:20 个学过的到期词 */
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

/** 一直答「认识」直到没牌了,返回停下时的 phase */
const drainSession = (): string => {
  let phase = "";
  for (let index = 0; index < 400; index += 1) {
    const session = getWordSession();
    phase = session.phase;
    if (!session.card) break;
    submitWordAnswer(session.card.id, "know");
  }
  return phase;
};

const one = (sql: string, params: unknown[] = []) => {
  const result = testDb.exec(sql, params as never)[0];
  return result?.values?.[0]?.[0] ?? null;
};
const count = (sql: string, params: unknown[] = []) => Number(one(sql, params) ?? 0);

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  prefStore.clear();
  saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 5, reviewCap: 20 });
  ensureProgressInitialized();
  seedSmallPlan();
});

describe("三个方向平级、互不干扰", () => {
  it("快速学习按到期优先级稳定输出，不使用普通会话的随机首屏", () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    testDb.run(`
      UPDATE progress
      SET fsrs_due = ?, fsrs_last_review = ?, fsrs_state = 2, fsrs_reps = 5, fsrs_lapses = 0
      WHERE word_id = 1
    `, [daysAgo(30), daysAgo(40)]);
    testDb.run(`
      UPDATE progress
      SET fsrs_due = ?, fsrs_last_review = ?, fsrs_state = 2, fsrs_reps = 5, fsrs_lapses = 0
          , seen_count = 5, known_forever = 0
      WHERE word_id = 5000
    `, [daysAgo(5), daysAgo(15)]);
    testDb.run(`
      UPDATE progress
      SET fsrs_due = ?, fsrs_last_review = ?, fsrs_state = 2, fsrs_reps = 5, fsrs_lapses = 0
          , seen_count = 5, known_forever = 0
      WHERE word_id = 10000
    `, [daysAgo(1), daysAgo(11)]);
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id BETWEEN 2 AND 20");

    const cards = getQuickStudySession(3).cards;
    expect(cards.map((card) => card.id)).toEqual([1, 5000, 10000]);
  });

  it("从例句词典加入的词进入今日任务且不重复计入", () => {
    expect(addWordToTodayEncore(30)).toBe(true);
    expect(count("SELECT COUNT(*) FROM stage1_tasks WHERE word_id = 30 AND task_type = 'encore_new'")).toBe(1);
    expect(addWordToTodayEncore(30)).toBe(false);
    expect(getWordSession().phase).toBe("stage1");
  });

  it("今日计划做完就是 done,不会自动接上反向", () => {
    expect(drainSession()).toBe("done");
  });

  it("光在首页看统计,不会给反向攒新卡(否则从不练反向的人天天欠债)", () => {
    getWordStats();
    expect(count("SELECT COUNT(*) FROM reverse_memory")).toBe(0);
  });

  it("进反向模式才建卡,而且是从正向状态播种的(不当全新卡)", () => {
    const session = continueStage2Study();
    expect(session.phase).toBe("stage2");
    expect(session.card).not.toBeNull();
    expect(count("SELECT COUNT(*) FROM reverse_memory")).toBeGreaterThan(0);
    // 正向 stability 是 8,播种取一半
    const seeded = Number(one("SELECT fsrs_stability FROM reverse_memory LIMIT 1"));
    expect(seeded).toBeCloseTo(8 * SEEDED_STABILITY_RATIO, 5);
  });

  it("反向已有到期卡时,新卡仍按新卡配额进入今天的任务", () => {
    // Keep one old direction card in the due set. The old implementation
    // re-queried that same due set after seeding and never inserted the new
    // cards it had just created.
    testDb.run("INSERT INTO reverse_memory (word_id, seen_count) VALUES (1, 1)");
    const session = continueStage2Study();
    expect(session.card).not.toBeNull();
    const newTasks = count(`
      SELECT COUNT(*)
      FROM stage2_progress t
      JOIN reverse_memory m ON m.word_id = t.word_id
      WHERE t.reviewed_on = ? AND m.seen_count = 0
    `, [today()]);
    expect(newTasks).toBe(5);
  });

  it("播种不会把低稳定度卡抬高到一天以上", () => {
    testDb.run("UPDATE progress SET fsrs_stability = 0.2 WHERE word_id = 1");
    continueStage2Study();
    const seeded = Number(one("SELECT fsrs_stability FROM reverse_memory WHERE word_id = 1"));
    expect(seeded).toBeCloseTo(0.1, 5);
  });

  it("反向作答不动正向的 due,正向作答也不动反向的 due", () => {
    const reverse = continueStage2Study();
    const wordId = reverse.card!.id;
    const forwardDueBefore = one("SELECT fsrs_due FROM progress WHERE word_id = ?", [wordId]);
    submitWordAnswer(wordId, "know");
    expect(one("SELECT fsrs_due FROM progress WHERE word_id = ?", [wordId])).toBe(forwardDueBefore);

    const reverseDueAfter = one("SELECT fsrs_due FROM reverse_memory WHERE word_id = ?", [wordId]);
    continueTodayPlanStudy();
    submitWordAnswer(wordId, "know");
    expect(one("SELECT fsrs_due FROM reverse_memory WHERE word_id = ?", [wordId])).toBe(reverseDueAfter);
  });

  it("反向的作答也进 reviews 流水,并且带方向", () => {
    const wordId = continueStage2Study().card!.id;
    submitWordAnswer(wordId, "know");
    expect(count("SELECT COUNT(*) FROM reviews WHERE direction = 'reverse'")).toBe(1);
    expect(count("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'")).toBe(0);
  });

  it("反向也用毕业判定算完成 —— 不再是 temp_score ≥ 10", () => {
    const wordId = continueStage2Study().card!.id;
    submitWordAnswer(wordId, "know");
    // 当天首答「认识」= Easy,跳过学习步骤直接毕业 → 下次到期排到明天以后
    const due = String(one("SELECT fsrs_due FROM reverse_memory WHERE word_id = ?", [wordId]));
    expect(new Date(due).getTime()).toBeGreaterThan(Date.now() + 12 * 3600_000);
    expect(getWordStats("stage2").stage2Completed).toBeGreaterThan(0);
  });

  it("汉字读音模式同样是独立一份记忆,只收含汉字的词", () => {
    const session = continueKanjiStudy();
    expect(session.phase).toBe("kanji");
    expect(session.card).not.toBeNull();
    const nonKanji = count(`
      SELECT COUNT(*) FROM kanji_reading_memory m JOIN words w ON w.id = m.word_id
      WHERE w.kanji = w.kana
    `);
    expect(nonKanji).toBe(0);
  });

  it("启用 unit 隔离开关后只写 unit 记忆，不写旧词方向流水", () => {
    setKanjiUnitSchedulerEnabled(true);
    const session = continueKanjiStudy();
    expect(session.phase).toBe("kanji");
    expect(session.unitKey).toEqual(expect.any(String));
    expect(session.unitTarget?.text).toBeTruthy();
    const wordId = session.card!.id;
    const seenBefore = count("SELECT seen_count FROM progress WHERE word_id = ?", [wordId]);

    const next = submitKanjiUnitAnswer(session.unitKey!, "know");
    expect(count("SELECT seen_count FROM kanji_unit_memory WHERE unit_key = ?", [session.unitKey!])).toBe(1);
    expect(count("SELECT COUNT(*) FROM reviews WHERE direction = 'kanji_reading'"),).toBe(0);
    expect(count("SELECT seen_count FROM progress WHERE word_id = ?", [wordId])).toBe(seenBefore);
    expect(next.stats.kanjiTotal).toBeGreaterThan(0);
    expect(next.stats.kanjiCompleted).toBeGreaterThanOrEqual(0);
  });

  it("表记审计只移出不适用的今日汉字任务，长期记忆原样保留", () => {
    // 这条盯的是**词级旧路径**的表记剪枝,所以要显式关掉单位调度开关(现在默认开)
    setKanjiUnitSchedulerEnabled(false);
    const due = new Date(Date.now() - 86_400_000).toISOString();
    testDb.run("UPDATE words SET kanji = '殆ど', kana = 'ほとんど' WHERE id = 1");
    testDb.run(`
      INSERT INTO kanji_reading_memory
        (word_id, seen_count, fsrs_due, fsrs_state, fsrs_reps, fsrs_stability, fsrs_difficulty)
      VALUES (1, 3, ?, 2, 3, 5, 5)
    `, [due]);
    testDb.run(`
      INSERT INTO kanji_reading_progress (reviewed_on, word_id, order_index)
      VALUES (?, 1, 1)
    `, [today()]);

    const session = continueKanjiStudy();
    expect(session.card?.id).not.toBe(1);
    expect(count("SELECT COUNT(*) FROM kanji_reading_progress WHERE word_id = 1")).toBe(0);
    expect(count("SELECT COUNT(*) FROM kanji_reading_memory WHERE word_id = 1 AND seen_count = 3")).toBe(1);
  });

  it("新汉字读音作答使用新方向流水，不混入旧汉字模式历史", () => {
    const wordId = continueKanjiStudy().card!.id;
    submitWordAnswer(wordId, "know");
    expect(count("SELECT COUNT(*) FROM reviews WHERE direction = 'kanji_reading'")).toBe(1);
    expect(count("SELECT COUNT(*) FROM reviews WHERE direction = 'kanji'")).toBe(0);
  });

  it("从反向切回今日计划:phase 会被摆正,不会继续出反向题", () => {
    expect(continueStage2Study().phase).toBe("stage2");
    const back = continueTodayPlanStudy();
    expect(back.phase).toBe("stage1");
    expect(back.card).not.toBeNull();
  });

  it("三个方向各自一份每日上限,互不挤占", () => {
    continueStage2Study();
    continueKanjiStudy();
    const stats = getWordStats();
    expect(count("SELECT COUNT(*) FROM stage1_tasks")).toBeLessThanOrEqual(25);
    expect(count("SELECT COUNT(*) FROM stage2_progress")).toBeLessThanOrEqual(25);
    expect(count("SELECT COUNT(*) FROM kanji_reading_progress")).toBeLessThanOrEqual(25);
    expect(stats.modeCounts.reverse).toBeGreaterThan(0);
    expect(stats.modeCounts.kanji).toBeGreaterThan(0);
  });
});
