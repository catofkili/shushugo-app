import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key)
};
(globalThis as any).window = { dispatchEvent: () => true };

let testDb: Database;
vi.mock("./database", () => ({ getDatabase: () => testDb }));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));

import { ensureUserTables, today } from "./study-core";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { firstValue, rowsFor, setState } from "./database/db-utils";
import { answerLevelAdvance, levelAdvancePrompt } from "./level-advance";
import { ensureGrammarProgressInitialized } from "./grammar-api";
import { ensureFsrsColumns, GRAMMAR_FSRS } from "./fsrs-store";
import { currentPlanLevelRanks, planLevelRankSql } from "./plan-level-order";
import { getGrammarQuizSession, grammarAudioPlan, grammarNewQuota, PLAN_GRAMMAR_LEVEL, scopeLevels } from "./grammar-quiz";
import { pickMixedNext, resetMixedSession } from "./mixed-session";
import { defaultStudyPreferences, getEffectiveStudyPreferences, getStudyPreferences, readLevelAdvance, type StudyPreferences } from "./studyPreferences";

const setTarget = (jlptTarget: StudyPreferences["jlptTarget"]) =>
  storage.set("mn-study-preferences", JSON.stringify({ ...defaultStudyPreferences, dailyGoal: 15, jlptTarget }));
const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date(2026, 9, 28, 9);

/** 把某一级的前 percent% 个词标成学过，其余清零 */
const setLevelSeen = (level: string, percent: number) => {
  const ids = testDb.exec("SELECT id FROM words WHERE jlpt_level = ? ORDER BY id", [level])[0].values.map((row) => row[0] as number);
  const cut = Math.ceil(ids.length * percent / 100);
  testDb.run("UPDATE progress SET seen_count = 0, known_forever = 0 WHERE word_id IN (SELECT id FROM words WHERE jlpt_level = ?)", [level]);
  if (cut > 0) testDb.run(`UPDATE progress SET seen_count = 1 WHERE word_id IN (${ids.slice(0, cut).join(",")})`);
};

/** 语法进度只用真实流水，不拿先验的 seen_count 冒充答题。 */
const setGrammarAnswered = (level: string, percent: number) => {
  const ids = rowsFor("SELECT id FROM grammar_points WHERE level = ? ORDER BY id", [level]).map((row) => Number(row.id));
  testDb.run("DELETE FROM grammar_reviews WHERE grammar_id IN (SELECT id FROM grammar_points WHERE level = ?)", [level]);
  testDb.run("UPDATE grammar_progress SET seen_count = 0, known_forever = 0 WHERE grammar_id IN (SELECT id FROM grammar_points WHERE level = ?)", [level]);
  for (const id of ids.slice(0, Math.ceil(ids.length * percent / 100))) {
    testDb.run("INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on) VALUES (?, 'know', 0, '2026-10-27')", [id]);
    testDb.run("UPDATE grammar_progress SET seen_count = 1, fsrs_due = '2099-01-01' WHERE grammar_id = ?", [id]);
  }
};

describe("单词 / 语法一级学到 95% 问往上、回补或暂停", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    ensureUserTables();
    ensureProgressInitialized();
    ensureGrammarProgressInitialized();
    ensureFsrsColumns(GRAMMAR_FSRS);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    testDb.run("DELETE FROM grammar_reviews");
    testDb.run("DELETE FROM grammar_state");
    testDb.run("DELETE FROM level_prior_baselines");
    testDb.run("UPDATE grammar_progress SET seen_count = 0, known_forever = 0, fsrs_due = NULL, fsrs_last_review = NULL, fsrs_state = NULL");
    setTarget("N5");
    setState("level_advance", "");
    setState("level_prior_applied", "");
    setState("starting_level", "");
    for (const level of ["N5", "N4", "N3", "N2"]) setLevelSeen(level, 0);
  });

  afterEach(() => vi.useRealTimers());

  it("差一点不问，到 95% 才问，问的是下一级", () => {
    setLevelSeen("N5", 90);
    expect(levelAdvancePrompt(t0)).toBeNull();
    setLevelSeen("N5", 96);
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "words", level: "N5", next: "N4", backfill: null, again: false });
  });

  it("单词往上：记账、不再问，也不动每日新词数", () => {
    setLevelSeen("N5", 96);
    answerLevelAdvance("words", "N5", "up", t0);
    expect(levelAdvancePrompt(t0)).toBeNull();
    expect(getEffectiveStudyPreferences(t0).dailyGoal).toBe(15);
    expect(readLevelAdvance().words).toMatchObject({ answered: ["N5"], upTo: "N4", pausedAt: 0 });
    expect(currentPlanLevelRanks("words")[1]).toBe(1);
    expect(currentPlanLevelRanks("grammar")[1]).toBeGreaterThanOrEqual(100);
    setLevelSeen("N4", 96);
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "words", level: "N4", next: "N3" });
  });

  it("只按目标级别报：目标 N3 时 N5、N4 学完了也不问，N3 到 95% 才问", () => {
    setTarget("N3");
    setLevelSeen("N5", 100);
    setLevelSeen("N4", 100);
    expect(levelAdvancePrompt(t0)).toBeNull();
    setLevelSeen("N3", 96);
    expect(levelAdvancePrompt(t0)).toMatchObject({ level: "N3", next: "N2" });
  });

  it("目标改了，旧目标的暂停作废", () => {
    setLevelSeen("N5", 96);
    answerLevelAdvance("words", "N5", "pause", t0);
    setTarget("N4");
    expect(levelAdvancePrompt(t0)).toBeNull();
    expect(getEffectiveStudyPreferences(t0).dailyGoal).toBe(15);
  });

  it("选暂停：先学完这一级（每日量封顶在剩余数、不溢出到下一级），到 100% 才停一周，满一周再问", () => {
    setLevelSeen("N5", 96);
    answerLevelAdvance("words", "N5", "pause", t0);
    expect(levelAdvancePrompt(t0)).toBeNull();
    expect(getEffectiveStudyPreferences(t0).dailyGoal).toBe(15); // 还剩好几十个，照常学
    expect(JSON.parse(storage.get("mn-study-preferences")!).dailyGoal).toBe(15); // 存的额度不被改写

    const total = testDb.exec("SELECT COUNT(*) FROM words WHERE jlpt_level = 'N5'")[0].values[0][0] as number;
    testDb.run("UPDATE progress SET seen_count = 1 WHERE word_id IN (SELECT id FROM words WHERE jlpt_level = 'N5' ORDER BY id LIMIT ?)", [total - 3]);
    expect(getEffectiveStudyPreferences(t0).dailyGoal).toBe(3);

    setLevelSeen("N5", 100);
    const t1 = new Date(t0.getTime() + 2 * DAY); // 两天后才学完：一周从这里起算，不从点按钮起算
    expect(getEffectiveStudyPreferences(t1).dailyGoal).toBe(0);
    expect(levelAdvancePrompt(t1)).toBeNull();
    expect(getEffectiveStudyPreferences(new Date(t1.getTime() + 6 * DAY)).dailyGoal).toBe(0);
    expect(levelAdvancePrompt(new Date(t1.getTime() + 6 * DAY))).toBeNull();

    const after = new Date(t1.getTime() + 7 * DAY);
    expect(getEffectiveStudyPreferences(after).dailyGoal).toBe(15);
    expect(levelAdvancePrompt(after)).toMatchObject({ level: "N5", next: "N4", again: true });

    answerLevelAdvance("words", "N5", "pause", after); // 再暂停一周：已经 100%，下次刷新即开始计时
    expect(getEffectiveStudyPreferences(after).dailyGoal).toBe(0);
    levelAdvancePrompt(after);
    answerLevelAdvance("words", "N5", "up", after);
    expect(levelAdvancePrompt(new Date(after.getTime() + 8 * DAY))).toBeNull();
    expect(getEffectiveStudyPreferences(after).dailyGoal).toBe(15);
  });

  it("目标被起点先验盖住不问：起点 N5（熟悉度 75）目标 N5 从 N4 起算", () => {
    setState("level_prior_applied", JSON.stringify({ level: "N5", familiarity: { words: 75 } }));
    setLevelSeen("N5", 100);
    expect(levelAdvancePrompt(t0)).toBeNull();
  });

  it("目标 N1 没有下一级，不问", () => {
    setTarget("N1");
    testDb.run("UPDATE progress SET seen_count = 1 WHERE word_id IN (SELECT id FROM words WHERE jlpt_level = 'N1')");
    expect(levelAdvancePrompt(t0)).toBeNull();
    testDb.run("UPDATE progress SET seen_count = 0");
  });

  it("语法真实答过不到 95% 不问，到 95% 提供相邻回补", () => {
    setTarget("N3");
    setGrammarAnswered("N3", 94);
    expect(levelAdvancePrompt(t0)).toBeNull();
    setGrammarAnswered("N3", 95);
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "grammar", level: "N3", next: "N2", backfill: "N4", again: false });
  });

  it("语法标熟知也算学到；重复流水不会重复计数", () => {
    setTarget("N3");
    testDb.run("UPDATE grammar_progress SET known_forever = 1 WHERE grammar_id IN (SELECT id FROM grammar_points WHERE level = 'N3')");
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "grammar", percent: 100 });
    setGrammarAnswered("N3", 1);
    testDb.run("INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on) SELECT grammar_id, answer, score_after, reviewed_on FROM grammar_reviews");
    expect(levelAdvancePrompt(t0)).toBeNull();
  });

  it("语法先验基线卡的 seen_count 不算真实学过；前沿被先验盖住也不问", () => {
    setTarget("N3");
    testDb.run(`INSERT INTO level_prior_baselines
      (entity, entity_key, stability, due, last_review, starting_level, familiarity)
      SELECT 'grammar', CAST(id AS TEXT), 30, '2099-01-01', '2026-10-01', 'N3', 75 FROM grammar_points WHERE level = 'N3'`);
    testDb.run("UPDATE grammar_progress SET seen_count = 1 WHERE grammar_id IN (SELECT id FROM grammar_points WHERE level = 'N3')");
    expect(levelAdvancePrompt(t0)).toBeNull();
    setGrammarAnswered("N3", 95); // 真答过后才算；基线保留，不排除真实流水。
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "grammar" });
    setState("level_prior_applied", JSON.stringify({ level: "N3", familiarity: { grammar: 75, words: 0 } }));
    expect(levelAdvancePrompt(t0)).toBeNull();
  });

  it("语法往上扩过滤范围，混合出题和例句预取自然包含新一级，备考目标不变", () => {
    setTarget("N3");
    testDb.run("UPDATE grammar_progress SET known_forever = 1 WHERE grammar_id IN (SELECT id FROM grammar_points WHERE level IN ('N5', 'N4', 'N3'))");
    expect(scopeLevels(PLAN_GRAMMAR_LEVEL)).toEqual(["N5", "N4", "N3"]);
    expect(getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).card).toBeNull();
    answerLevelAdvance("grammar", "N3", "pause", t0);
    answerLevelAdvance("grammar", "N3", "up", t0);
    expect(readLevelAdvance().grammar).toMatchObject({ upTo: "N2", answered: ["N3"], pausedAt: 0, stoppedAt: 0, pausedLevel: "" });
    expect(scopeLevels(PLAN_GRAMMAR_LEVEL)).toEqual(["N5", "N4", "N3", "N2"]);
    expect(scopeLevels("N3")).toEqual(["N3"]); // 语法页手选等级仍只出那一级。
    const { card } = getGrammarQuizSession(PLAN_GRAMMAR_LEVEL);
    expect(card).toMatchObject({ level: "N2", isNew: true });
    resetMixedSession();
    expect(pickMixedNext({ word: false })).toMatchObject({ kind: "grammar", card: { level: "N2" } });
    expect(grammarAudioPlan(PLAN_GRAMMAR_LEVEL)).toContain(card!.exampleJp);
    expect(currentPlanLevelRanks("grammar")[3]).toBe(3);
    expect(currentPlanLevelRanks("words")[3]).toBeGreaterThanOrEqual(100);
    expect(getStudyPreferences().jlptTarget).toBe("N3");
    testDb.run("UPDATE grammar_progress SET known_forever = 1 WHERE grammar_id IN (SELECT id FROM grammar_points WHERE level = 'N2')");
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "grammar", level: "N2", next: "N1" });
  });

  it.each(["words", "grammar"] as const)("%s 回补只提紧邻一级，压过 N5，且不影响别的种类", (kind) => {
    setTarget("N3");
    answerLevelAdvance(kind, "N3", "pause", t0);
    answerLevelAdvance(kind, "N3", "back", t0);
    const ranks = currentPlanLevelRanks(kind);
    expect(ranks[1]).toBeLessThan(Math.min(...ranks.filter((_, index) => index !== 1)));
    expect(currentPlanLevelRanks(kind === "words" ? "grammar" : "words")[1]).toBe(1);
    expect(currentPlanLevelRanks("kanji")[1]).toBe(1);
    expect(readLevelAdvance()[kind]).toMatchObject({ backfill: "N4", answered: ["N3"], pausedAt: 0, stoppedAt: 0, pausedLevel: "" });
    if (kind === "grammar") expect(getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).card).toMatchObject({ level: "N4", isNew: true });
    else expect(rowsFor(`SELECT w.jlpt_level FROM words w JOIN progress p ON p.word_id = w.id
      WHERE p.seen_count = 0 AND p.known_forever = 0 ORDER BY ${planLevelRankSql("w.jlpt_level", "words")} LIMIT 1`)[0].jlpt_level).toBe("N4");
    expect(getStudyPreferences().jlptTarget).toBe("N3");
  });

  it("紧邻一级已经没有新内容时，不提供回补，不跳到 N5", () => {
    setTarget("N3");
    setGrammarAnswered("N3", 95);
    setGrammarAnswered("N4", 100);
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "grammar", backfill: null });
    answerLevelAdvance("grammar", "N3", "back", t0);
    expect(readLevelAdvance().grammar.backfill).toBe("");
    expect(getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).card?.level).toBe("N5");
  });

  it("语法暂停封顶独立额度，100% 后停一周再问；旧加餐不穿透暂停", () => {
    setTarget("N3");
    setGrammarAnswered("N3", 99);
    const unseen = firstValue<number>("SELECT COUNT(*) FROM grammar_points g JOIN grammar_progress p ON p.grammar_id = g.id WHERE g.level = 'N3' AND p.seen_count = 0", [], 0);
    expect(unseen).toBeGreaterThan(0);
    answerLevelAdvance("grammar", "N3", "pause", t0);
    expect(getEffectiveStudyPreferences(t0)).toMatchObject({ grammarDailyGoal: unseen, dailyGoal: 15 });
    expect(getStudyPreferences().grammarDailyGoal).toBe(5);
    expect(grammarNewQuota(PLAN_GRAMMAR_LEVEL)).toBe(unseen);
    testDb.run("INSERT INTO grammar_state (key, value) VALUES (?, ?)", ["quiz_encore:plan", JSON.stringify({ day: today(), count: 10 })]);
    expect(grammarNewQuota(PLAN_GRAMMAR_LEVEL)).toBe(unseen);
    setGrammarAnswered("N3", 100);
    const stopped = new Date(t0.getTime() + 2 * DAY);
    vi.setSystemTime(stopped);
    expect(levelAdvancePrompt(stopped)).toBeNull();
    expect(getEffectiveStudyPreferences(stopped)).toMatchObject({ grammarDailyGoal: 0, dailyGoal: 15 });
    expect(grammarNewQuota(PLAN_GRAMMAR_LEVEL)).toBe(0);
    expect(getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).card).toBeNull();
    testDb.run("UPDATE grammar_progress SET seen_count = 1, fsrs_due = ? WHERE grammar_id = (SELECT id FROM grammar_points WHERE level = 'N5' LIMIT 1)", [stopped.toISOString()]);
    expect(getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).card).toMatchObject({ level: "N5", isNew: false }); // 暂停不拦复习。
    const after = new Date(stopped.getTime() + 7 * DAY);
    expect(levelAdvancePrompt(new Date(after.getTime() - 1))).toBeNull();
    expect(levelAdvancePrompt(after)).toMatchObject({ kind: "grammar", again: true });
    expect(getEffectiveStudyPreferences(after).grammarDailyGoal).toBe(5);
    answerLevelAdvance("grammar", "N3", "pause", after);
    expect(levelAdvancePrompt(after)).toBeNull();
    expect(readLevelAdvance().grammar.stoppedAt).toBe(after.getTime());
    answerLevelAdvance("grammar", "N3", "up", after);
    expect(getEffectiveStudyPreferences(after).grammarDailyGoal).toBe(5);
  });

  it("两类同时触发时单词优先，答完才出现语法，单词暂停不压语法额度", () => {
    setTarget("N3");
    setLevelSeen("N3", 96);
    setGrammarAnswered("N3", 95);
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "words" });
    answerLevelAdvance("words", "N3", "pause", t0);
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "grammar" });
    expect(getEffectiveStudyPreferences(t0).grammarDailyGoal).toBe(5);
  });

  it("单词提醒在前时也会启动语法暂停的一周计时，两类状态不互相覆盖", () => {
    setTarget("N3");
    setGrammarAnswered("N3", 100);
    answerLevelAdvance("grammar", "N3", "pause", t0);
    setLevelSeen("N3", 96);
    expect(levelAdvancePrompt(t0)).toMatchObject({ kind: "words" });
    expect(readLevelAdvance().grammar.stoppedAt).toBe(t0.getTime());
    answerLevelAdvance("words", "N3", "back", t0);
    expect(readLevelAdvance().grammar.stoppedAt).toBe(t0.getTime());
  });

  it("旧扁平状态按 words 读取，写新回答时保留旧暂停", () => {
    setState("level_advance", JSON.stringify({ answered: ["N5"], pausedAt: t0.getTime(), stoppedAt: 0, pausedLevel: "N3" }));
    expect(readLevelAdvance().words).toEqual({ answered: ["N5"], pausedAt: t0.getTime(), stoppedAt: 0, pausedLevel: "N3", upTo: "", backfill: "" });
    expect(readLevelAdvance().grammar).toEqual({ answered: [], pausedAt: 0, stoppedAt: 0, pausedLevel: "", upTo: "", backfill: "" });
    answerLevelAdvance("grammar", "N3", "up", t0);
    expect(readLevelAdvance().words.pausedAt).toBe(t0.getTime());
    expect(readLevelAdvance().grammar.upTo).toBe("N2");
  });

  it("语法前沿 N1 不再问，扩展范围取目标与 upTo 中较高者", () => {
    setTarget("N3");
    answerLevelAdvance("grammar", "N2", "up", t0);
    setGrammarAnswered("N1", 100);
    expect(levelAdvancePrompt(t0)).toBeNull();
    expect(scopeLevels(PLAN_GRAMMAR_LEVEL)).toEqual(["N5", "N4", "N3", "N2", "N1"]);
    setTarget("N1");
    answerLevelAdvance("grammar", "N3", "up", t0);
    expect(scopeLevels(PLAN_GRAMMAR_LEVEL)).toContain("N1");
  });
});
