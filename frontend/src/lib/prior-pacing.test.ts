import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const preferences = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => preferences.get(key) ?? null,
  setItem: (key: string, value: string) => preferences.set(key, String(value)),
  removeItem: (key: string) => preferences.delete(key)
};
(globalThis as any).window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
vi.mock("./database", () => ({ getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => testDb.export(), openDatabase: async (bytes: Uint8Array) => new SQL.Database(bytes), importDatabase: async () => undefined }));
vi.mock("./storage", () => ({ scheduleSave: vi.fn(), requestFullSnapshot: vi.fn() }));

import {
  advancePriorPace, forecastPriorReleases, pendingPriorSql, priorIdsForEntity, priorValidatedToday, readPriorPace,
  rebuildPriorPace, releasedPriorIds, undoPriorValidation, PRIOR_CHECK_EVERY, PRIOR_ENTITIES, PRIOR_QUOTA_INITIAL, PRIOR_QUOTA_MAX, PRIOR_QUOTA_MIN
} from "./prior-pacing";
import type { PlanKind } from "./plan-level-order";
import { firstValue, rowsFor, setState, studyDayEnd, today } from "./database/db-utils";
import { ensureUserTables } from "./study-core";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { ensureGrammarProgressInitialized } from "./grammar-api";
import { defaultStudyPreferences, getStudyPreferences, saveStudyPreferences } from "./studyPreferences";
import { fsrsDueCount, fsrsDueWordIds, plannedDueCount, WORD_FSRS } from "./fsrs-store";
import { createStage1Tasks, pickStage1Next, stage1ProgressCounts } from "./word-api/stage1";
import { createDirectionTasks, directionProgressCounts, pickDirectionNext } from "./word-api/direction-plan";
import { ensureDirectionColumns, KANJI, REVERSE } from "./word-api/directions";
import { addWordToTodayEncore, getWordSession, startEncore, submitWordAnswer, undoLastWordAnswer } from "./word-api";
import { getWordStats } from "./word-api/stats";
import { getGrammarQuizSession, grammarPlanRemaining, PLAN_GRAMMAR_LEVEL, submitGrammarQuizAnswer, undoLastGrammarQuizAnswer } from "./grammar-quiz";
import { createKanjiCharTasks, kanjiCharPool, kanjiCharProgress, loadKanjiCharData, materializeKanjiChars, pickKanjiCharNext, recordKanjiCharReview, undoLastKanjiCharReview } from "./kanji-char-cards";
import { allKanjiReadingQuestionChars } from "./kanji-reading-usage";
import { confusionCardPool, confusionCardProgress, createConfusionTasks, materializeConfusionCards, pickConfusionNext, recordConfusionReview, undoLastConfusionReview } from "./confusion-cards";
import { mixedCardCounts } from "./mixed-cards";
import { dailyPlanView, saveDailyPlan } from "./daily-plan";
import { getJlptPlanStatus } from "./jlpt/status";
import { recordReviewEvent } from "./reviews";
import { createKanjiUnitTasks, materializeKanjiUnitIndex, pickKanjiUnitNext } from "./kanji-unit-scheduler";
import { SYNCED_TABLES, isDeviceLocalStateKey } from "./sync/tables";
import { mergeDatabaseBytes } from "./sync/merge";

const kinds = Object.keys(PRIOR_ENTITIES) as PlanKind[];
const oldDue = "2000-01-01T12:00:00.000Z";
const lastReview = new Date(Date.now() - 30 * 86_400_000).toISOString();
const keysFor = (kind: PlanKind, count: number): string[] => {
  const { table, idColumn } = PRIOR_ENTITIES[kind];
  const eligibleChars = new Set(allKanjiReadingQuestionChars());
  return rowsFor(`SELECT ${idColumn} AS k FROM ${table} ORDER BY ${idColumn}`)
    .map((row) => String(row.k)).filter((key) => kind !== "kanji" || eligibleChars.has(key)).slice(0, count);
};
const seed = (kind: PlanKind, keys: string[], withBaseline = true, due = oldDue) => {
  const { table, idColumn } = PRIOR_ENTITIES[kind];
  for (const key of keys) {
    testDb.run(`UPDATE ${table} SET known_forever = 0, seen_count = 1, fsrs_stability = 30, fsrs_difficulty = 5,
      fsrs_due = ?, fsrs_last_review = ?, fsrs_state = 2, fsrs_steps = 0, fsrs_reps = 0, fsrs_lapses = 0 WHERE ${idColumn} = ?`, [due, lastReview, key]);
    if (withBaseline) testDb.run(`INSERT OR REPLACE INTO level_prior_baselines
      (entity, entity_key, stability, due, last_review, starting_level, familiarity) VALUES (?, ?, 30, ?, ?, 'N5', 75)`, [kind, key, due, lastReview]);
  }
};
const makeTasks = (kind: PlanKind) => {
  if (kind === "words") createStage1Tasks(today());
  else if (kind === "kanji") createKanjiCharTasks({ fresh: 0, review: 1 }, 4);
  else if (kind === "confusion") createConfusionTasks({ fresh: 0, review: 1 }, 4);
};
const remaining = (kind: PlanKind): number => {
  if (kind === "words") { const p = stage1ProgressCounts(); return p.total - p.completed; }
  if (kind === "grammar") return grammarPlanRemaining(PLAN_GRAMMAR_LEVEL);
  return kind === "kanji" ? kanjiCharProgress().remaining : confusionCardProgress().remaining;
};
const pick = (kind: PlanKind, excluded = new Set<string>()): string | null => {
  if (kind === "words") return pickStage1Next(new Set([...excluded].map(Number)), { deterministic: true })?.id.toString() ?? null;
  if (kind === "grammar") return getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).card?.id.toString() ?? null;
  return kind === "kanji" ? pickKanjiCharNext(today(), excluded) : pickConfusionNext(today(), excluded);
};
const answer = (kind: PlanKind, key: string, value: "know" | "fuzzy" | "forgot" = "know") => {
  if (kind === "words") {
    setState("phase", "stage1"); setState("phase_date", today()); setState("current_card", key);
    submitWordAnswer(Number(key), value);
  } else if (kind === "grammar") submitGrammarQuizAnswer(PLAN_GRAMMAR_LEVEL, Number(key), value);
  else if (kind === "kanji") recordKanjiCharReview(key, value);
  else recordConfusionReview(key, value);
};
const undo = (kind: PlanKind) => {
  if (kind === "words") { setState("phase", "stage1"); undoLastWordAnswer(); }
  else if (kind === "grammar") undoLastGrammarQuizAnswer(PLAN_GRAMMAR_LEVEL);
  else if (kind === "kanji") undoLastKanjiCharReview();
  else undoLastConfusionReview();
};

beforeAll(async () => { SQL = await initSqlJs(); await loadKanjiCharData(); });
beforeEach(() => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(new URL("../../public/nihongo.db", import.meta.url))));
  preferences.clear();
  ensureUserTables(); ensureProgressInitialized(); ensureGrammarProgressInitialized();
  materializeKanjiChars(); materializeConfusionCards();
  kinds.forEach((kind) => testDb.run(`UPDATE ${PRIOR_ENTITIES[kind].table} SET known_forever = 1`));
  saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 5, grammarDailyGoal: 0, kanjiDailyGoal: 0, confusionDailyGoal: 0,
    reviewCap: 1, grammarReviewCap: 1, kanjiReviewCap: 1, confusionReviewCap: 1, jlptTarget: "N1", jlptPlanEnabled: false });
});
afterEach(async () => {
  await vi.dynamicImportSettled();
  testDb.close();
});

describe("先验额度", () => {
  it("每满一个窗口才检查：90% 减一个，60% 加一个，中间不变，窗口清零", () => {
    const run = (correct: number, quota = PRIOR_QUOTA_INITIAL) => Array.from({ length: PRIOR_CHECK_EVERY }, (_, index) => index < correct ? "know" : "fuzzy")
      .reduce(advancePriorPace, { quota, window: [] as string[] });
    expect(run(Math.ceil(PRIOR_CHECK_EVERY * 0.9))).toEqual({ quota: PRIOR_QUOTA_INITIAL - 1, window: [] });
    expect(run(Math.floor(PRIOR_CHECK_EVERY * 0.6))).toEqual({ quota: PRIOR_QUOTA_INITIAL + 1, window: [] });
    expect(run(Math.ceil(PRIOR_CHECK_EVERY * 0.7))).toEqual({ quota: PRIOR_QUOTA_INITIAL, window: [] });
    expect(run(PRIOR_CHECK_EVERY, PRIOR_QUOTA_MIN).quota).toBe(PRIOR_QUOTA_MIN);
    expect(run(0, PRIOR_QUOTA_MAX).quota).toBe(PRIOR_QUOTA_MAX);
    const partial = Array.from({ length: PRIOR_CHECK_EVERY - 1 }, () => "know").reduce(advancePriorPace, { quota: PRIOR_QUOTA_INITIAL, window: [] as string[] });
    expect(partial.quota).toBe(PRIOR_QUOTA_INITIAL);
    expect(partial.window).toHaveLength(PRIOR_CHECK_EVERY - 1);
  });

  it("四份状态按 app_state 的 lww 同步，缺失或损坏用默认值，不写库", () => {
    expect(SYNCED_TABLES.find((table) => table.table === "app_state")?.strategy).toBe("lww");
    for (const kind of kinds) {
      expect(isDeviceLocalStateKey("app_state", `prior_pace:${kind}`)).toBe(false);
      expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_INITIAL, window: [] });
      setState(`prior_pace:${kind}`, "broken");
      expect(readPriorPace(kind).quota).toBe(PRIOR_QUOTA_INITIAL);
      setState(`prior_pace:${kind}`, JSON.stringify({ quota: PRIOR_QUOTA_MAX, window: ["know", "forgot"] }));
      expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_MAX, window: ["know", "forgot"] });
    }
    expect(readPriorPace("words").window).not.toBe(readPriorPace("grammar").window);
  });
});

it("事故回归：127 条语法已到期，只放初始额度；答完当天不再进卡，未放行的 FSRS 和基线不变", () => {
  const keys = keysFor("grammar", 127);
  expect(keys).toHaveLength(127);
  seed("grammar", keys);
  const allFsrs = () => rowsFor("SELECT grammar_id, fsrs_due, fsrs_last_review, fsrs_stability, fsrs_reps FROM grammar_progress WHERE known_forever = 0 ORDER BY grammar_id");
  const before = allFsrs();
  const baselines = rowsFor("SELECT * FROM level_prior_baselines ORDER BY entity_key");
  const ids = releasedPriorIds("grammar");
  expect(ids).toHaveLength(PRIOR_QUOTA_INITIAL);
  expect(getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).remaining).toBe(PRIOR_QUOTA_INITIAL);
  expect(allFsrs()).toEqual(before);
  const answered = new Set<string>();
  for (let step = 0; step < PRIOR_QUOTA_INITIAL; step += 1) {
    const key = pick("grammar")!; expect(key).toBeTruthy(); answered.add(key); answer("grammar", key);
  }
  expect(answered.size).toBe(PRIOR_QUOTA_INITIAL);
  expect(priorValidatedToday("grammar")).toBe(PRIOR_QUOTA_INITIAL);
  expect(releasedPriorIds("grammar")).toEqual([]);
  expect(pick("grammar")).toBeNull();
  expect(grammarPlanRemaining(PLAN_GRAMMAR_LEVEL)).toBe(0);
  expect(getGrammarQuizSession(PLAN_GRAMMAR_LEVEL).total).toBe(PRIOR_QUOTA_INITIAL);
  expect(allFsrs().filter((row) => !answered.has(String(row.grammar_id)))).toEqual(before.filter((row) => !answered.has(String(row.grammar_id))));
  expect(rowsFor("SELECT * FROM level_prior_baselines ORDER BY entity_key")).toEqual(baselines);
});

it.each(kinds)("%s：放行数 = 剩余计数 = 实际能出的卡；普通 cap 不吞掉先验", (kind) => {
  seed(kind, keysFor(kind, PRIOR_QUOTA_INITIAL + 3));
  const released = releasedPriorIds(kind);
  expect(released).toHaveLength(PRIOR_QUOTA_INITIAL);
  makeTasks(kind);
  expect(remaining(kind)).toBe(released.length);
  const stats = getWordStats();
  const mixed = mixedCardCounts(testDb);
  const view = dailyPlanView();
  expect(stats.modeCounts.mixed).toBe(PRIOR_QUOTA_INITIAL);
  expect(view.segments.find((segment) => segment.kind === kind)?.review).toBe(PRIOR_QUOTA_INITIAL);
  if (kind === "grammar") expect(stats.grammarRemaining).toBe(PRIOR_QUOTA_INITIAL);
  if (kind === "kanji") { expect(mixed.kanjiRemaining).toBe(PRIOR_QUOTA_INITIAL); expect(kanjiCharPool(4).due).toBe(PRIOR_QUOTA_INITIAL); }
  if (kind === "confusion") { expect(mixed.confusionRemaining).toBe(PRIOR_QUOTA_INITIAL); expect(confusionCardPool(4).due).toBe(PRIOR_QUOTA_INITIAL); }
  const seen = new Set<string>();
  while (seen.size < PRIOR_QUOTA_INITIAL) {
    const key = pick(kind)!; expect(key).toBeTruthy(); expect(seen.has(key)).toBe(false);
    seen.add(key); answer(kind, key);
  }
  expect(seen).toEqual(new Set(released));
  expect(remaining(kind)).toBe(0); expect(pick(kind)).toBeNull();
  expect(releasedPriorIds(kind)).toEqual([]);
  expect(getWordStats().modeCounts.mixed).toBe(0);
});

it.each(kinds)("%s：只有首次作答进窗口，重复刷不算；撤销跨越检查点会还原额度和名额", (kind) => {
  const keys = keysFor(kind, PRIOR_CHECK_EVERY);
  seed(kind, keys);
  for (const key of keys) answer(kind, key);
  expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_INITIAL - 1, window: [] });
  undo(kind);
  expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_INITIAL, window: Array(PRIOR_CHECK_EVERY - 1).fill("know") });
  expect(priorValidatedToday(kind)).toBe(PRIOR_CHECK_EVERY - 1);
  answer(kind, keys[keys.length - 1]);
  answer(kind, keys[0], "forgot");
  expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_INITIAL - 1, window: [] });
});

it.each(kinds)("%s：合并后撤销本机首答后，远端流水接替首答也必须重算额度", async (kind) => {
  const keys = keysFor(kind, PRIOR_CHECK_EVERY);
  seed(kind, keys);
  const remote = new SQL.Database(testDb.export());
  try {
    const correct = Math.ceil(PRIOR_CHECK_EVERY * 0.9);
    keys.forEach((key, index) => answer(kind, key, index < PRIOR_CHECK_EVERY - correct ? "forgot" : "know"));
    expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_INITIAL - 1, window: [] });
    const key = keys[keys.length - 1];
    const { reviews, idColumn } = PRIOR_ENTITIES[kind];
    const localReview = rowsFor(`SELECT sync_uid FROM ${reviews} WHERE ${idColumn} = ?`, [key])[0];
    const later = Date.now() + 60_000;
    const required = kind === "words" || kind === "grammar" ? "score_after" : "reviewed_at";
    remote.run(`INSERT INTO ${reviews} (${idColumn}, answer, reviewed_on, created_at, sync_uid, ${required})
      VALUES (?, 'forgot', ?, ?, ?, ?)`, [key, today(), new Date(later).toISOString(), `remote:${kind}:${key}`, required === "reviewed_at" ? later : 0]);
    if (kind === "words") remote.run("UPDATE reviews SET reviewed_at = ? WHERE sync_uid = ?", [later, `remote:${kind}:${key}`]);
    await mergeDatabaseBytes(remote.export());
    expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_INITIAL - 1, window: [] });
    // 按本机流水身份撤销；同卡远端流水保留，仍然是已验证先验。
    testDb.run(`DELETE FROM ${reviews} WHERE sync_uid = ?`, [String(localReview.sync_uid)]);
    expect(firstValue(`SELECT ${pendingPriorSql(kind, "?")}`, [key, key], 1)).toBe(0);
    undoPriorValidation(kind, key);
    expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_INITIAL, window: [] });
    expect(priorValidatedToday(kind)).toBe(PRIOR_CHECK_EVERY);
  } finally { remote.close(); }
});

it.each(kinds)("%s：验证过的基线卡回归普通 FSRS，不被待验证限速挡住", (kind) => {
  const keys = keysFor(kind, PRIOR_QUOTA_INITIAL + 2);
  seed(kind, keys);
  answer(kind, keys[0]);
  const { table, idColumn, reviews } = PRIOR_ENTITIES[kind];
  testDb.run(`UPDATE ${reviews} SET reviewed_on = '1999-12-31' WHERE ${idColumn} = ?`, [keys[0]]);
  testDb.run(`UPDATE ${table} SET fsrs_due = ? WHERE ${idColumn} = ?`, [oldDue, keys[0]]);
  expect(firstValue(`SELECT ${pendingPriorSql(kind, "?")}`, [keys[0], keys[0]], 1)).toBe(0);
  makeTasks(kind);
  expect(remaining(kind)).toBe(PRIOR_QUOTA_INITIAL + 1);
  const candidates = new Set<string>();
  for (let step = 0; step < PRIOR_QUOTA_INITIAL + 1; step += 1) {
    const key = pick(kind)!; expect(key).toBeTruthy(); candidates.add(key); answer(kind, key);
  }
  expect(candidates.has(keys[0])).toBe(true);
});

it("放行按 due 最早，未来先验不提前；已验证计入额度，次日重新放行", () => {
  const keys = keysFor("words", PRIOR_QUOTA_INITIAL + 4);
  seed("words", keys);
  const oldest = keys[keys.length - 1];
  testDb.run("UPDATE progress SET fsrs_due = '1990-01-01T00:00:00.000Z' WHERE word_id = ?", [oldest]);
  const future = keys[0];
  testDb.run("UPDATE progress SET fsrs_due = '2099-01-01T00:00:00.000Z' WHERE word_id = ?", [future]);
  expect(releasedPriorIds("words")[0]).toBe(oldest);
  expect(releasedPriorIds("words")).not.toContain(future);
  const chosen = releasedPriorIds("words");
  chosen.forEach((key) => answer("words", key));
  expect(priorIdsForEntity(WORD_FSRS)).toEqual([]);
  const tomorrow = new Date(`${today()}T12:00:00`); tomorrow.setDate(tomorrow.getDate() + 1);
  expect(releasedPriorIds("words", studyDayEnd(tomorrow), today(tomorrow))).toHaveLength(keys.length - PRIOR_QUOTA_INITIAL - 1);
});

it("单词正向、反向和旧汉字读音共享放行名单，旧任务池和续杯都不能绕过", () => {
  const keys = keysFor("words", PRIOR_QUOTA_INITIAL + 4);
  seed("words", keys);
  for (const direction of [REVERSE, KANJI]) {
    ensureDirectionColumns(direction);
    for (const key of keys) testDb.run(`INSERT OR REPLACE INTO ${direction.entity.table} (word_id, seen_count, fsrs_due, fsrs_state) VALUES (?, 1, ?, 2)`, [key, oldDue]);
  }
  // 模拟升级时已经塞满的三份物化计划。
  for (const [index, key] of keys.entries()) {
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, ?, 'review', ?)", [today(), key, index]);
    for (const direction of [REVERSE, KANJI]) testDb.run(`INSERT INTO ${direction.taskTable} (reviewed_on, word_id, order_index) VALUES (?, ?, ?)`, [today(), key, index]);
  }
  expect(stage1ProgressCounts().total).toBe(PRIOR_QUOTA_INITIAL);
  createDirectionTasks(REVERSE); createDirectionTasks(KANJI);
  expect(directionProgressCounts(REVERSE).total).toBe(PRIOR_QUOTA_INITIAL);
  expect(priorIdsForEntity(REVERSE.entity)).toEqual(releasedPriorIds("words"));
  releasedPriorIds("words").forEach((key) => recordReviewEvent({ wordId: Number(key), answer: "know", direction: "reverse", reviewedOn: today() }));
  expect(priorValidatedToday("words")).toBe(PRIOR_QUOTA_INITIAL);
  expect(releasedPriorIds("words")).toEqual([]);
  // 已验证卡在正向仍可正常复习；剩下的待验证卡不会从旧任务或加餐漏进来。
  const before = new Set(rowsFor("SELECT word_id FROM stage1_tasks").map((row) => String(row.word_id)));
  startEncore(PRIOR_QUOTA_MAX);
  const after = rowsFor("SELECT word_id FROM stage1_tasks").map((row) => String(row.word_id));
  expect(after.every((key) => before.has(key))).toBe(true);
  expect(priorIdsForEntity(KANJI.entity)).toEqual([]);
  expect(pickDirectionNext(REVERSE)?.id).toBeDefined();
});

it("汉字单元按 unit_key 自己记 FSRS；例词有 words 先验也不制造单词验证", () => {
  materializeKanjiUnitIndex();
  const unitKeys = rowsFor("SELECT unit_key FROM kanji_unit_memory LIMIT ?", [PRIOR_QUOTA_INITIAL + 2]).map((row) => String(row.unit_key));
  unitKeys.forEach((key) => testDb.run("UPDATE kanji_unit_memory SET seen_count = 1, fsrs_due = ? WHERE unit_key = ?", [oldDue, key]));
  seed("words", keysFor("words", PRIOR_QUOTA_INITIAL + 3));
  const plan = createKanjiUnitTasks(today(), unitKeys.length);
  expect(plan.reviewCount).toBe(unitKeys.length);
  expect(pickKanjiUnitNext()).toBeTruthy();
  expect(priorValidatedToday("words")).toBe(0);
});

it("筛选学习的到期池和兜底都不能绕过先验放行名单", () => {
  const keys = rowsFor("SELECT id FROM words WHERE jlpt_level = 'N5' ORDER BY id LIMIT ?", [PRIOR_QUOTA_INITIAL + 3]).map((row) => String(row.id));
  seed("words", keys);
  const admitted = new Set(releasedPriorIds("words"));
  const options = { level: "N5" } as const;
  for (let step = 0; step < PRIOR_QUOTA_INITIAL; step += 1) {
    const card = getWordSession(options).card;
    expect(card).toBeTruthy();
    expect(admitted.delete(String(card!.id))).toBe(true);
    submitWordAnswer(card!.id, "know", options);
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id = ?", [card!.id]);
  }
  expect(admitted.size).toBe(0);
  expect(getWordStats("filtered", options).lowCount).toBe(0);
  expect(getWordSession(options).card).toBeNull();
});

it("例句词典加餐不能把尚未放行的先验插进今日任务", () => {
  const keys = keysFor("words", PRIOR_QUOTA_INITIAL + 1);
  seed("words", keys);
  const released = new Set(releasedPriorIds("words"));
  const held = keys.find((key) => !released.has(key))!;
  expect(addWordToTodayEncore(Number(held))).toBe(false);
  expect(firstValue("SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND word_id = ?", [today(), held], -1)).toBe(0);
});

it("圆环写回 cap 减掉显示时加上的验证名额，备考积压不包含未验证先验", () => {
  seed("words", keysFor("words", PRIOR_QUOTA_INITIAL + 4));
  seed("grammar", keysFor("grammar", PRIOR_QUOTA_INITIAL + 4));
  const view = dailyPlanView();
  const next = Object.fromEntries(view.segments.map((segment) => [segment.kind, { fresh: segment.fresh, review: segment.review }])) as Record<PlanKind, { fresh: number; review: number }>;
  next.words.review += 2; next.grammar.review += 2;
  saveDailyPlan(next, false, view);
  const quotas = getStudyPreferences();
  expect(dailyPlanView().priorExtras?.words).toBe(PRIOR_QUOTA_INITIAL);
  const status = getJlptPlanStatus();
  expect(status.plan.reviewWords).toBe(PRIOR_QUOTA_INITIAL);
  expect(status.plan.reviewGrammar).toBe(PRIOR_QUOTA_INITIAL);
  expect(quotas.reviewCap).toBe(2);
  expect(quotas.grammarReviewCap).toBe(2);
});

it("负荷预测把老 due 的先验按每天额度展开，不伪造原库的到期日", () => {
  seed("grammar", keysFor("grammar", PRIOR_QUOTA_INITIAL * 3));
  const ends = Array.from({ length: 3 }, (_, index) => { const end = studyDayEnd(); end.setDate(end.getDate() + index); return end; });
  expect(forecastPriorReleases("grammar", ends)).toEqual(Array(ends.length).fill(PRIOR_QUOTA_INITIAL));
});

it("云合并后本机 id 更大的早期流水仍是首答，窗口按真实时间重建", () => {
  const keys = keysFor("words", PRIOR_CHECK_EVERY);
  seed("words", keys);
  keys.forEach((key) => recordReviewEvent({ wordId: Number(key), answer: "forgot", direction: "forward", reviewedOn: today() }));
  keys.forEach((key) => recordReviewEvent({ wordId: Number(key), answer: "know", direction: "reverse", reviewedOn: "1999-12-31" }));
  rebuildPriorPace("words");
  expect(readPriorPace("words")).toEqual({ quota: PRIOR_QUOTA_INITIAL - 1, window: [] });
});

it.each(kinds)("%s：同一时刻的首答用 sync_uid 消歧，设备重排本机 id 不改变额度", (kind) => {
  const keys = keysFor(kind, PRIOR_CHECK_EVERY);
  seed(kind, keys);
  const { reviews, idColumn } = PRIOR_ENTITIES[kind];
  const required = kind === "words" || kind === "grammar" ? "score_after" : "reviewed_at";
  for (const key of keys) {
    for (const [value, identity] of [["know", "z"], ["forgot", "a"]]) {
      testDb.run(`INSERT INTO ${reviews} (${idColumn}, answer, reviewed_on, created_at, sync_uid, ${required})
        VALUES (?, ?, ?, '2000-01-01 12:00:00', ?, 0)`, [key, value, today(), `${identity}:${key}`]);
    }
  }
  rebuildPriorPace(kind);
  const expected = { quota: PRIOR_QUOTA_INITIAL + 1, window: [] };
  expect(readPriorPace(kind)).toEqual(expected);
  testDb.run(`UPDATE ${reviews} SET id = -id`);
  rebuildPriorPace(kind);
  expect(readPriorPace(kind)).toEqual(expected);
});

it("跨设备合并四类首答后自动重放额度，LWW 的旧窗口不能覆盖流水并集，重复合并不重计", async () => {
  const keys = Object.fromEntries(kinds.map((kind) => [kind, keysFor(kind, PRIOR_CHECK_EVERY)])) as Record<PlanKind, string[]>;
  kinds.forEach((kind) => seed(kind, keys[kind]));
  const remote = new SQL.Database(testDb.export());
  try {
    const split = Math.floor(PRIOR_CHECK_EVERY / 2);
    for (const kind of kinds) {
      keys[kind].slice(0, split).forEach((key) => answer(kind, key));
      const { reviews, idColumn } = PRIOR_ENTITIES[kind];
      const required = kind === "words" || kind === "grammar" ? "score_after" : "reviewed_at";
      keys[kind].slice(split).forEach((key) => remote.run(`INSERT INTO ${reviews} (${idColumn}, answer, reviewed_on, sync_uid, ${required})
        VALUES (?, 'know', ?, ?, ?)`, [key, today(), `remote:${kind}:${key}`, required === "reviewed_at" ? Date.now() : 0]));
      remote.run("INSERT OR REPLACE INTO app_state (key, value, sync_updated_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z')",
        [`prior_pace:${kind}`, JSON.stringify({ quota: PRIOR_QUOTA_MAX, window: [] })]);
    }
    const bytes = remote.export();
    for (let merge = 0; merge < 2; merge += 1) {
      await mergeDatabaseBytes(bytes);
      for (const kind of kinds) {
        expect(readPriorPace(kind)).toEqual({ quota: PRIOR_QUOTA_INITIAL - 1, window: [] });
        expect(priorValidatedToday(kind)).toBe(PRIOR_CHECK_EVERY);
      }
    }
  } finally { remote.close(); }
});

it("没有先验的老用户：FSRS 到期、原复习上限和四类出题行为保持原样", () => {
  const count = PRIOR_QUOTA_INITIAL + 2;
  for (const kind of kinds) seed(kind, keysFor(kind, count), false);
  expect(fsrsDueCount(studyDayEnd())).toBe(count);
  expect(plannedDueCount(studyDayEnd())).toBe(count);
  expect(fsrsDueWordIds(1, studyDayEnd())).toHaveLength(1);
  for (const kind of kinds) {
    makeTasks(kind);
    expect(releasedPriorIds(kind)).toEqual([]);
    expect(remaining(kind)).toBe(1);
    expect(pick(kind)).toBeTruthy();
  }
  expect(firstValue("SELECT COUNT(*) FROM app_state WHERE key LIKE 'prior_pace:%'", [], -1)).toBe(0);
});
