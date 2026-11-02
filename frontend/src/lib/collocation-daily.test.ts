import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";
import content from "../data/jlpt_collocation_content.json";

let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let seed: Uint8Array;
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key)
});
vi.stubGlobal("window", { dispatchEvent: () => true });
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./storage", () => ({ scheduleSave: vi.fn(), requestFullSnapshot: vi.fn() }));
vi.mock("./progress-events", () => ({ notifyProgressUpdated: vi.fn(), notifyTodayWordPlanUpdated: vi.fn() }));

import { firstValue, rowsFor, setState, today } from "./study-core";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { COLLOCATION_DAILY_NEW, createStage1Tasks, encoreRemainingCount, pickStage1Next, STAGE1_PLAN_VERSION, tomorrowWordAudioPlan } from "./word-api/stage1";
import { setLastAnsweredWord } from "./word-api/session-state";
import { collocationTier, wordCollocationTier } from "./collocation-tier";
import { collocationWordSql, wordStartedSql } from "./word-learning-scope";
import { defaultStudyPreferences, getStudyPreferences, levelUnseenContent, readLevelAdvance } from "./studyPreferences";
import { answerLevelAdvance, levelAdvancePrompt } from "./level-advance";
import { dailyPlanView, examPreset, previewCurrentLevelPlan, remainingPlanWords } from "./daily-plan";
import { getJlptPlanStatus } from "./jlpt/status";
import { fsrsDueWordIds } from "./fsrs-store";
import { addWordsToQueue, addWordToTodayEncore, getWordSession, startEncore } from "./word-api";
import { pickedWordIds, setPickedWords } from "./word-api/picked";

const NORMAL = 60000, COLLOCATION = 61000, NEXT_LEVEL = 62000;
const setGoal = (dailyGoal: number, includeOptionalExpressions = false) => storage.set("mn-study-preferences", JSON.stringify({
  ...defaultStudyPreferences, jlptTarget: "N3", dailyGoal, includeOptionalExpressions,
  jlptExamDate: "2027-07-04", jlptPlanStartedOn: "2026-11-02"
}));
const insertCollocation = (id: number, entry: typeof content.entries[number]) => {
  db.run("INSERT INTO words (id,kanji,kana,meaning,pos,jlpt_level,importance,shuffle_rank,example_jp,example_meaning,collocation_tier) VALUES (?,?,?,?,'固定搭配',?,3,0,'','',?)",
    [id, entry.surface, entry.kana, entry.meaning, entry.level, entry.t ?? 1]);
  db.run("INSERT INTO progress (word_id) VALUES (?)", [id]);
};
const newTasks = () => rowsFor(`
  SELECT w.*, t.task_type, ${collocationWordSql()} AS collocation, ${wordStartedSql()} AS started
  FROM stage1_tasks t JOIN words w ON w.id = t.word_id JOIN progress p ON p.word_id = w.id
  WHERE t.reviewed_on = ? AND t.task_type IN ('new', 'encore_new') ORDER BY t.order_index
`, [today()]);
const pendingCollocations = () => newTasks().filter((row) => row.collocation && !row.started);
const addTask = (id: number, order: number, type = "new") => db.run(
  "INSERT INTO stage1_tasks (reviewed_on,word_id,task_type,order_index) VALUES (?,?,?,?)", [today(), id, type, order]
);
const answer = (id: number, day = today(), direction = "forward") => {
  db.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on,direction) VALUES (?,'know',0,?,?)", [id, day, direction]);
  db.run("UPDATE progress SET seen_count=1, fsrs_state=2, fsrs_due='2099-01-01' WHERE word_id=?", [id]);
  setLastAnsweredWord(id);
};

// 同档内是 ABS(RANDOM())：固定拿某个编号会偶尔撞上当天被系统抽中的 3 个，测试要先排除它们。
const unqueuedCollocations = () => {
  const queued = new Set(newTasks().map((row) => Number(row.id)));
  return Array.from({ length: 20 }, (_, i) => COLLOCATION + i).filter((id) => !queued.has(id)).reverse();
};
describe("固定搭配独立每日新学配额", () => {
  beforeAll(async () => {
    const initWeappSqlJs = createRequire(import.meta.url)("../../../wechat-miniprogram/src/vendor/sql-wasm.js") as
      (options: { wasmBinary: Uint8Array }) => ReturnType<typeof initSqlJs>;
    SQL = await initWeappSqlJs({ wasmBinary: readFileSync(new URL("../../../wechat-miniprogram/src/assets/sql-wasm.wasm", import.meta.url)) });
    db = new SQL.Database(new Uint8Array(readFileSync(new URL("../../public/nihongo.db", import.meta.url))));
    ensureProgressInitialized();
    db.run("UPDATE words SET jlpt_level='N1'");
    db.run("UPDATE progress SET known_forever=1");
    for (const [base, level, count] of [[NORMAL, "N3", 30], [NEXT_LEVEL, "N2", 15]] as const) {
      for (let i = 0; i < count; i++) {
        db.run("INSERT INTO words (id,kanji,kana,meaning,pos,jlpt_level,importance,shuffle_rank,example_jp,example_meaning) VALUES (?,?,?,'普通词','名词',?,10,0,'','')",
          [base + i, `普通${base + i}`, `かな${base + i}`, level]);
        db.run("INSERT INTO progress (word_id) VALUES (?)", [base + i]);
      }
    }
    const n3 = content.entries.filter((entry) => entry.level === "N3");
    const entries = [...n3.filter((entry) => collocationTier(entry) === "core").slice(0, 2),
      ...n3.filter((entry) => collocationTier(entry) === "common").slice(0, 18)];
    entries.forEach((entry, index) => insertCollocation(COLLOCATION + index, entry));
    seed = db.export();
    db.close();
  });
  beforeEach(() => {
    db = new SQL.Database(seed);
    storage.clear();
    setGoal(10);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T10:00:00+08:00"));
    setState("stage1_plan_version", STAGE1_PLAN_VERSION);
  });
  afterEach(async () => { await vi.dynamicImportSettled(); vi.useRealTimers(); db.close(); });

  it("三档全部 790 条都由 pos 片段识别，未知搭配也不漏掉，空词性仍是普通词", () => {
    db.run(`DELETE FROM words AS w WHERE ${collocationWordSql()}`);
    content.entries.forEach((entry, index) => insertCollocation(70000 + index, entry));
    expect(firstValue<number>(`SELECT COUNT(*) FROM words w WHERE ${collocationWordSql()}`, [], 0)).toBe(790);
    insertCollocation(71000, { ...content.entries[0], surface: "未知の搭配", kana: "みちのたくはい" });
    expect(firstValue<number>(`SELECT ${collocationWordSql()} FROM words w WHERE id=71000`, [], 0)).toBe(1);
    db.run("UPDATE words SET pos='' WHERE id=?", [NORMAL]);
    createStage1Tasks(today());
    expect(newTasks().filter((row) => !row.collocation)).toHaveLength(10);
  });
  it("N3 普通词 30、搭配 20，dailyGoal 10 给 10 个普通词再加 3 个搭配，core 先于 common", () => {
    createStage1Tasks(today());
    expect(newTasks().filter((row) => !row.collocation)).toHaveLength(10);
    expect(pendingCollocations()).toHaveLength(COLLOCATION_DAILY_NEW);
    expect(pendingCollocations().map(wordCollocationTier)).toEqual(["core", "core", "common"]);
    expect(newTasks().every((row) => row.jlpt_level === "N3")).toBe(true);
    createStage1Tasks(today());
    expect(newTasks()).toHaveLength(13);
  });
  it("N3 普通词学完后普通名额继续给 N2，N3 搭配仍限 3 个", () => {
    db.run("UPDATE progress SET known_forever=1 WHERE word_id>=? AND word_id<?", [NORMAL, COLLOCATION]);
    createStage1Tasks(today());
    const ordinary = newTasks().filter((row) => !row.collocation);
    expect(ordinary).toHaveLength(10);
    expect(ordinary.every((row) => row.jlpt_level === "N2")).toBe(true);
    expect(pendingCollocations()).toHaveLength(3);
    expect(pendingCollocations().every((row) => row.jlpt_level === "N3")).toBe(true);
  });
  it("已首答 5 个搭配，旧计划的 8 个未答全移走，补满普通词，已答及复习行原样保留", () => {
    for (let i = 0; i < 5; i++) { answer(COLLOCATION + i); addTask(COLLOCATION + i, i); }
    for (let i = 5; i < 13; i++) addTask(COLLOCATION + i, i, i === 12 ? "encore_new" : "new");
    answer(COLLOCATION + 19, "2026-11-01");
    db.run("UPDATE progress SET fsrs_due='2026-11-01' WHERE word_id=?", [COLLOCATION + 19]);
    addTask(COLLOCATION + 19, 100, "review");
    const keep = rowsFor("SELECT * FROM stage1_tasks WHERE order_index<5 OR task_type='review'");
    createStage1Tasks(today());
    expect(pendingCollocations()).toHaveLength(0);
    expect(newTasks().filter((row) => !row.collocation)).toHaveLength(10);
    expect(rowsFor("SELECT * FROM stage1_tasks WHERE order_index<5 OR task_type='review'")).toEqual(keep);
  });
  it("已首答 2 个只留 1 个未答搭配，优先保留 core；重复和任意方向流水只扣一次", () => {
    answer(COLLOCATION + 2, today(), "reverse");
    answer(COLLOCATION + 2);
    answer(COLLOCATION + 3);
    for (const [index, id] of [COLLOCATION + 4, COLLOCATION + 5, COLLOCATION].entries()) addTask(id, index);
    createStage1Tasks(today());
    expect(pendingCollocations().map((row) => row.id)).toEqual([COLLOCATION]);
  });
  it("dailyGoal 为 0 时旧计划未答搭配也清掉，真实已答任务保留", () => {
    createStage1Tasks(today());
    answer(COLLOCATION);
    setGoal(0);
    createStage1Tasks(today());
    expect(pendingCollocations()).toHaveLength(0);
    expect(newTasks().map((row) => row.id)).toEqual([COLLOCATION]);
  });
  it("dailyGoal 为 0 的冷启动不建普通新词或搭配任务", () => {
    setGoal(0);
    createStage1Tasks(today());
    expect(newTasks()).toHaveLength(0);
  });
  it("首次实际出题遵守 core→common，上一张新搭配之后先给普通词；只剩搭配时能收尾", () => {
    createStage1Tasks(today());
    const seenTiers: Array<string | null> = [];
    let lastCollocation = false;
    for (let i = 0; i < 13; i++) {
      const card = pickStage1Next(new Set(), { deterministic: true })!;
      const tier = wordCollocationTier(rowsFor("SELECT pos,collocation_tier FROM words WHERE id=?", [card.id])[0]);
      if (lastCollocation && tier) expect(newTasks().filter((row) => !row.collocation && !row.started)).toHaveLength(0);
      if (tier) seenTiers.push(tier);
      lastCollocation = tier !== null;
      answer(card.id);
    }
    expect(seenTiers).toEqual(["core", "core", "common"]);
    expect(pickStage1Next(new Set(), { deterministic: true })).toBeNull();
  });
  it("搭配也先按计划级别顺推，较低级 common 排在较高级 core 前", () => {
    const n4 = content.entries.filter((entry) => entry.level === "N4" && collocationTier(entry) === "common");
    n4.slice(0, 3).forEach((entry, index) => insertCollocation(63000 + index, entry));
    setState("level_prior_applied", JSON.stringify({ level: "N5", familiarity: { words: 75 } }));
    createStage1Tasks(today());
    expect(pendingCollocations().map((row) => row.jlpt_level)).toEqual(["N4", "N4", "N4"]);
  });
  it("optional 只在开关打开时进入独立配额，并排在 common 后", () => {
    const optional = content.entries.find((entry) => entry.level === "N3" && collocationTier(entry) === "optional")!;
    insertCollocation(63000, optional);
    db.run("UPDATE progress SET known_forever=1 WHERE word_id>=? AND word_id<?", [COLLOCATION + 2, COLLOCATION + 20]);
    createStage1Tasks(today());
    expect(pendingCollocations()).toHaveLength(2);
    setGoal(10, true);
    createStage1Tasks(today());
    expect(pendingCollocations().map(wordCollocationTier)).toEqual(["core", "core", "optional"]);
    setGoal(10, false);
    createStage1Tasks(today());
    expect(pendingCollocations()).toHaveLength(2);
  });
  it("先验搭配今天首答不算新学；以前学过的搭配到期仍照常复习", () => {
    for (let i = 0; i < 5; i++) {
      db.run(`INSERT INTO level_prior_baselines (entity,entity_key,stability,due,last_review,starting_level,familiarity)
        VALUES ('words',?,30,'2026-11-01','2026-10-01','N3',75)`, [String(COLLOCATION + i)]);
      answer(COLLOCATION + i);
    }
    answer(COLLOCATION + 19, "2026-11-01");
    db.run("UPDATE progress SET fsrs_due='2026-11-01' WHERE word_id=?", [COLLOCATION + 19]);
    expect(fsrsDueWordIds(10)).toContain(COLLOCATION + 19);
    createStage1Tasks(today());
    expect(pendingCollocations()).toHaveLength(3);
    expect(firstValue<string>("SELECT task_type FROM stage1_tasks WHERE word_id=?", [COLLOCATION + 19], "")).toBe("review");
  });
  it("N3 普通词 100%、搭配 0% 就会问升级，回补和暂停收尾也只数普通词", () => {
    db.run("UPDATE progress SET seen_count=1 WHERE word_id>=? AND word_id<?", [NORMAL, NORMAL + 30]);
    expect(levelAdvancePrompt()).toMatchObject({ kind: "words", level: "N3", percent: 100, backfill: null });
    expect(levelUnseenContent("words", "N3")).toBe(0);
    answerLevelAdvance("words", "N3", "pause");
    levelAdvancePrompt();
    expect(readLevelAdvance().words.stoppedAt).toBe(Date.now());
    createStage1Tasks(today());
    expect(pendingCollocations()).toHaveLength(0);
  });
  it("真实计划池、备考预设与每日推荐只数普通词，覆盖总量仍含搭配", () => {
    expect(remainingPlanWords("kana", "N3")).toBe(30);
    expect(examPreset("N3").remaining.words).toBe(30);
    expect(previewCurrentLevelPlan({ startingLevel: "N4", target: "N3", examDate: new Date("2027-07-04") }).content.words).toBe(30);
    expect(dailyPlanView().segments.find((segment) => segment.kind === "words")?.pool.unseen).toBe(30);
    const before = getJlptPlanStatus();
    db.run(`UPDATE progress SET known_forever=1 WHERE word_id IN (SELECT w.id FROM words w WHERE ${collocationWordSql()})`);
    expect(getJlptPlanStatus().plan.newWords).toBe(before.plan.newWords);
    expect(before.coverage.words.total).toBe(50);
    expect(getStudyPreferences().dailyGoal).toBe(10);
  });
  it("筛选及兜底、自动加餐和明日新词音频不泄漏新搭配，到期搭配保留在续杯余量", () => {
    createStage1Tasks(today());
    expect(tomorrowWordAudioPlan().some((row) => content.entries.some((entry) => entry.surface === row.kanji))).toBe(false);
    startEncore(10);
    expect(newTasks().filter((row) => row.task_type === "encore_new").every((row) => !row.collocation)).toBe(true);
    db.run("UPDATE progress SET known_forever=1 WHERE word_id<? OR word_id>=?", [COLLOCATION, COLLOCATION + 20]);
    expect(getWordSession({ level: "N3" }).card).toBeNull();
    expect(encoreRemainingCount(today())).toBe(0);
    const [due] = unqueuedCollocations();
    answer(due, "2026-11-01");
    db.run("UPDATE progress SET fsrs_due='2026-11-01' WHERE word_id=?", [due]);
    expect(encoreRemainingCount(today())).toBe(1);
    expect(getWordSession({ level: "N3" }).card?.id).toBe(due);
  });
  it("词典点名、词库加入今天和自选清单仍可显式学习搭配", () => {
    createStage1Tasks(today());
    const [named, added] = unqueuedCollocations();
    expect(addWordToTodayEncore(named)).toBe(true);
    expect(addWordsToQueue([added]).today).toBe(1);
    createStage1Tasks(today());
    expect(newTasks().map((row) => row.id)).toContain(named);
    expect(newTasks().map((row) => row.id)).toContain(added);
    setPickedWords([COLLOCATION + 17]);
    expect(pickedWordIds()).toEqual([COLLOCATION + 17]);
  });
  it.each([false, true])("显式点名已经在独立日额里的搭配仍保留（普通名额已答满：%s）", (completed) => {
    createStage1Tasks(today());
    if (completed) for (const row of newTasks().filter((row) => !row.collocation)) answer(Number(row.id));
    expect(addWordsToQueue([COLLOCATION]).today).toBe(1);
    createStage1Tasks(today());
    expect(newTasks().map((row) => row.id)).toContain(COLLOCATION);
  });
});
