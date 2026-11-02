/**
 * 改池子操作的 CI 保险：默认运行，出厂内容只读进内存，选卡、评分、FSRS、合并均走应用入口。
 * 先做较早的真实学习，再留下五天每天每类三张的平时历史；积压靠时间自然形成，绝不改 due。
 * 按一天内不同卡片计数：重复重学不加量；先验首答单列，验证后的次日复习归普通复习。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Console } from "node:console";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const preferences = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => preferences.get(key) ?? null,
  setItem: (key: string, value: string) => preferences.set(key, String(value)),
  removeItem: (key: string) => preferences.delete(key)
});
vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
vi.stubEnv("TZ", "Asia/Singapore");
vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb, exportDatabase: () => testDb.export(),
  openDatabase: async (bytes: Uint8Array) => new SQL.Database(bytes), createDatabase: async () => new SQL.Database()
}));
vi.mock("./storage", () => ({ scheduleSave: vi.fn(), requestFullSnapshot: vi.fn() }));
vi.mock("./database/db-utils", async importOriginal => ({
  ...await importOriginal<typeof import("./database/db-utils")>(), persistSoon: vi.fn(), persistContentSoon: vi.fn()
}));

import { ensureSeedData, ensureUserTables, GRAMMAR_SEED_VERSION } from "./study-core";
import { firstValue, getState, rowsFor, setState, studyDayEnd, today } from "./database/db-utils";
import { getLevelPlanSettings, hydrateLevelPlanPreferences, recalibrateLevelStartingPoint, saveLevelPlanSettings } from "./level-plan";
import { answerLevelAdvance, levelAdvancePrompt } from "./level-advance";
import { getGrammarQuizSession, PLAN_GRAMMAR_LEVEL, scopeLevels, submitGrammarQuizAnswer } from "./grammar-quiz";
import { getConfusionCardSession, getKanjiCardSession, loadMixedCardData, submitConfusionCardAnswer, submitKanjiCardAnswer } from "./mixed-cards";
import { groupLevelRank, matchable } from "./confusion-cards";
import { confusionGroups } from "./confusion-groups";
import { COLLOCATION_DAILY_NEW, createStage1Tasks, pickStage1Next } from "./word-api/stage1";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { submitWordAnswer } from "./word-api";
import { defaultStudyPreferences, getEffectiveStudyPreferences, getStudyPreferences, readLevelAdvance, saveStudyPreferences } from "./studyPreferences";
import { dailyReviewCap, planReviewLimit } from "./review-budget";
import { pendingPriorSql, PRIOR_ENTITIES, PRIOR_QUOTA_MAX } from "./prior-pacing";
import type { PlanKind } from "./plan-level-order";
import { mergeDatabaseBytes } from "./sync/merge";
import { ensureSyncSchema, resetDeviceId } from "./sync/schema";
import { exportSyncSnapshot } from "./sync/snapshot";

const KINDS = ["words", "grammar", "kanji", "confusion"] as const;
// 直写终端，让 CI 的通过日志也留下可对照的峰值。
const console = new Console(process.stdout, process.stderr);
const DAY_MS = 86_400_000;
const START = new Date(2026, 10, 2, 9).getTime();
const factory = new Uint8Array(readFileSync(new URL("../../public/nihongo.db", import.meta.url)));
const familiarity = { words: 75, grammar: 75, kanji: 75, confusion: 75 };
const byKind = <T>(make: (kind: PlanKind) => T) => Object.fromEntries(KINDS.map(kind => [kind, make(kind)])) as Record<PlanKind, T>;
interface Load { review: number; fresh: number; prior: number; total: number; answers: number }
interface DayLoad { day: string; cards: Record<PlanKind, Load>; limits: Record<PlanKind, number>; goals: Record<PlanKind, number> }
const at = (offset: number) => vi.setSystemTime(START + offset * DAY_MS);
const seedRandom = () => {
  let random = 20261102;
  vi.spyOn(Math, "random").mockImplementation(() => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random / 4294967296;
  });
};
let baseline: Uint8Array;
let savedPreferences: Map<string, string>;

const open = (bytes: Uint8Array) => {
  testDb = new SQL.Database(bytes);
  // SQLite 不跟随 vi 的时钟；首答重放必须与应用日期使用同一个时刻。
  const driver = testDb as Database & { create_function(name: string, fn: () => string | number): void };
  driver.create_function("current_timestamp", () => new Date().toISOString());
  driver.create_function("random", () => Math.floor(Math.random() * 2147483648));
};

/** 可以提前离开会话来构造平时历史；正式验收不传张数，必须一直答到应用返回 null。 */
function finish(kind: PlanKind, grammarLevel = PLAN_GRAMMAR_LEVEL, onCard = (_key: string) => {}, stopAfter = Infinity) {
  let steps = 0;
  const answer = (key: string, write: () => unknown) => {
    onCard(key);
    vi.setSystemTime(Date.now() + 1000);
    write();
    expect(++steps, `${today()} ${kind} 会话应能结束`).toBeLessThan(2000);
  };
  if (kind === "words") {
    setState("phase", "stage1");
    setState("phase_date", today());
    createStage1Tasks(today());
    for (let card = pickStage1Next(); card && steps < stopAfter; card = pickStage1Next()) {
      const id = card.id;
      answer(String(id), () => { setState("current_card", String(id)); submitWordAnswer(id, "know", {}); });
    }
  } else if (kind === "grammar") {
    let session = getGrammarQuizSession(grammarLevel);
    while (session.card && steps < stopAfter) {
      const id = session.card.id;
      answer(String(id), () => { session = submitGrammarQuizAnswer(grammarLevel, id, "know"); });
    }
  } else if (kind === "kanji") {
    for (let session = getKanjiCardSession(testDb); session.card && steps < stopAfter; session = getKanjiCardSession(testDb)) {
      const char = session.card.char;
      answer(char, () => submitKanjiCardAnswer(char, "know"));
    }
  } else {
    for (let session = getConfusionCardSession(testDb); session.card && steps < stopAfter; session = getConfusionCardSession(testDb)) {
      const key = session.card.groupKey;
      answer(key, () => submitConfusionCardAnswer(key, "know"));
    }
  }
  return steps;
}

const priorCounts = (dueOnly = true) => byKind(kind => firstValue<number>(
  `SELECT COUNT(*) FROM ${PRIOR_ENTITIES[kind].table} WHERE ${pendingPriorSql(kind, `${PRIOR_ENTITIES[kind].table}.${PRIOR_ENTITIES[kind].idColumn}`)}${dueOnly ? " AND fsrs_due <= ?" : ""}`,
  dueOnly ? [studyDayEnd().toISOString()] : [], 0
));

/** 四天都跑完再断言，失败时仍能看到操作后的负荷峰值。 */
function observe(name: string): DayLoad[] {
  const days: DayLoad[] = [];
  for (let offset = 0; offset <= 3; offset += 1) {
    at(offset);
    const day = today();
    const prefs = getEffectiveStudyPreferences();
    expect([prefs.reviewCap, prefs.grammarReviewCap, prefs.kanjiReviewCap, prefs.confusionReviewCap], "四类始终使用自动档").toEqual([0, 0, 0, 0]);
    const record: DayLoad = {
      day,
      cards: byKind(() => ({ review: 0, fresh: 0, prior: 0, total: 0, answers: 0 })),
      limits: byKind(kind => kind === "words" ? dailyReviewCap(prefs.reviewCap, day) : planReviewLimit(0, kind, day)),
      // 固定搭配有独立日额（不占 dailyGoal），单词新学上限 = 普通名额 + 搭配日额；dailyGoal 为 0 时搭配也是 0。
      goals: { words: prefs.dailyGoal + (prefs.dailyGoal > 0 ? COLLOCATION_DAILY_NEW : 0), grammar: prefs.grammarDailyGoal, kanji: prefs.kanjiDailyGoal, confusion: prefs.confusionDailyGoal }
    };
    for (const kind of KINDS) {
      const { reviews, idColumn } = PRIOR_ENTITIES[kind];
      const history = new Set(rowsFor(`SELECT DISTINCT ${idColumn} AS k FROM ${reviews}`).map(row => String(row.k)));
      const priors = new Set(rowsFor("SELECT entity_key FROM level_prior_baselines WHERE entity = ?", [kind]).map(row => String(row.entity_key)));
      const seen = new Set<string>();
      finish(kind, PLAN_GRAMMAR_LEVEL, key => {
        const load = record.cards[kind];
        load.answers += 1;
        if (seen.has(key)) return;
        seen.add(key);
        load[history.has(key) ? "review" : priors.has(key) ? "prior" : "fresh"] += 1;
        load.total += 1;
      });
      expect(rowsFor(`SELECT COUNT(*) AS answers, COUNT(DISTINCT ${idColumn}) AS total FROM ${reviews} WHERE reviewed_on = ?`, [day])[0],
        `${name} ${day} ${kind} 应用取卡与真实流水对账`).toEqual({ answers: record.cards[kind].answers, total: record.cards[kind].total });
    }
    days.push(record);
  }
  console.info(`${name}：${KINDS.map(kind => {
    const peak = days.reduce((highest, day) => day.cards[kind].total > highest.cards[kind].total ? day : highest);
    const { review, fresh, prior, total } = peak.cards[kind];
    return `${kind} ${peak.day} 普通=${review}/${peak.limits[kind]} 新学=${fresh}/${peak.goals[kind]} 先验=${prior}/${PRIOR_QUOTA_MAX} 合计=${total}/${peak.limits[kind] + peak.goals[kind] + PRIOR_QUOTA_MAX}`;
  }).join("；")}`);
  return days;
}

function assertBounded(days: DayLoad[]) {
  for (const { day, cards, limits, goals } of days) for (const kind of KINDS) {
    const load = cards[kind];
    const label = `${day} ${kind}`;
    expect(load.review, `${label} 普通复习 实际/上限=${load.review}/${limits[kind]}`).toBeLessThanOrEqual(limits[kind]);
    expect(load.prior, `${label} 先验首答`).toBeLessThanOrEqual(PRIOR_QUOTA_MAX);
    expect(load.fresh, `${label} 新学`).toBeLessThanOrEqual(goals[kind]);
    expect(load.total, `${label} 合计`).toBeLessThanOrEqual(limits[kind] + goals[kind] + PRIOR_QUOTA_MAX);
  }
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("测试禁止联网"); }));
  vi.useFakeTimers({ toFake: ["Date"] });
  seedRandom();
  // runner 模式的动态导入可能取到实际存储模块；双重封住真实落盘和计时器。
  const storage = await vi.importActual<typeof import("./storage")>("./storage");
  vi.spyOn(storage, "scheduleSave").mockImplementation(() => undefined);
  vi.spyOn(storage, "requestFullSnapshot").mockImplementation(() => undefined);
  SQL = await initSqlJs();
  await loadMixedCardData();
  at(-70);
  open(factory);
  ensureUserTables();
  ensureProgressInitialized();
  saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 50, grammarDailyGoal: 30, kanjiDailyGoal: 40,
    confusionDailyGoal: 20, reviewCap: 0, grammarReviewCap: 0, kanjiReviewCap: 0, confusionReviewCap: 0,
    jlptTarget: "N3", jlptPlanEnabled: false });
  // 较早学习过的大池子用真实作答建立；五天的小量历史会压住自动档的中位数。
  for (let offset = -70; offset <= -66; offset += 1) {
    at(offset);
    finish("grammar", "N3");
    if (offset <= -69) for (const kind of ["words", "kanji"] as const) finish(kind);
  }
  at(-65);
  finish("grammar", "N2");
  // 辨析的早期作答取 N3 以上的真实卡，经正式评分入口记账；保留低级别未答卡给先验验证。
  // 否则按新学顺序先答完 N5/N4，四天里辨析先验全是 0，无法检验先验额度。
  const oldConfusions = confusionGroups().filter(group => matchable(group) && groupLevelRank(group) >= 2).slice(0, 40);
  expect(oldConfusions).toHaveLength(40);
  for (const group of oldConfusions) { vi.setSystemTime(Date.now() + 1000); submitConfusionCardAnswer(group.key, "know"); }
  at(-19);
  await saveLevelPlanSettings({ startingLevel: "N5", familiarity, target: "N3", examDate: "", startedOn: today(), planEnabled: false });
  // 两周内 50 条 N4 真实首答给自动重估提供证据；不手写 seen_count 或复习流水。
  at(-12);
  finish("words");
  expect(firstValue<number>(`SELECT COUNT(DISTINCT r.word_id) FROM reviews r JOIN words w ON w.id=r.word_id
    WHERE w.jlpt_level='N4' AND r.reviewed_on >= date(?, '-14 day')`, ["2026-11-02"], 0)).toBeGreaterThanOrEqual(50);
  saveStudyPreferences({ ...getStudyPreferences(), dailyGoal: 3, grammarDailyGoal: 3, kanjiDailyGoal: 3, confusionDailyGoal: 3 });
  for (let offset = -5; offset < 0; offset += 1) {
    at(offset);
    for (const kind of KINDS) expect(finish(kind, "N3", () => {}, 3), `${today()} ${kind} 平时历史`).toBe(3);
  }
  at(0);
  ensureSyncSchema();
  baseline = testDb.export();
  savedPreferences = new Map(preferences);
  await vi.dynamicImportSettled();
  testDb.close();
}, 60000);

function restoreBaseline() {
  preferences.clear();
  savedPreferences.forEach((value, key) => preferences.set(key, value));
  seedRandom();
  at(0);
  open(baseline);
}
beforeEach(restoreBaseline);
afterEach(async () => { await vi.dynamicImportSettled(); testDb.close(); });
afterAll(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("改到期池的操作不会爆量", () => {
  it("范围放开：目标 N3 不变，语法从只出 N3 改为 N5→N3", () => {
    expect(getStudyPreferences().jlptTarget).toBe("N3");
    expect(scopeLevels("N3")).toEqual(["N3"]);
    expect(scopeLevels(PLAN_GRAMMAR_LEVEL)).toEqual(["N5", "N4", "N3"]);
    expect(priorCounts().grammar, "起点先验已自然积压满 14 天").toBeGreaterThan(PRIOR_QUOTA_MAX);
    expect(getGrammarQuizSession("N3").card?.level).toBe("N3");
    const days = observe("范围放开");
    expect(days[0].cards.grammar.prior, "放开的低级别先验确实从正式会话出题").toBeGreaterThan(0);
    for (const kind of KINDS) expect(days.some(day => day.cards[kind].prior > 0), `${kind} 必须实际验证过先验，避免空断言`).toBe(true);
    assertBounded(days);
  }, 60000);

  it.todo("单词独立范围放开：stage1 没有范围开关，17c0f468 改的是新词排序；不可调用旧代码冒充操作（其余操作仍验单词）");

  it("换起点及自动重估：N5→N4，只重写尚未真实作答的先验", async () => {
    const before = priorCounts();
    expect(await recalibrateLevelStartingPoint()).toBe(true);
    expect(JSON.parse(getState("level_prior_applied", "")).level).toBe("N4");
    expect(priorCounts().grammar).not.toBe(before.grammar);
    assertBounded(observe("自动重估起点"));

    // 从同一份平时历史重来：手动保存也要真正改池子，不能只测重估之后的幂等保存。
    await vi.dynamicImportSettled();
    testDb.close();
    restoreBaseline();
    await saveLevelPlanSettings({ ...getLevelPlanSettings()!, startingLevel: "N4", planEnabled: false });
    expect(getLevelPlanSettings()?.startingLevel).toBe("N4");
    expect(JSON.parse(getState("level_prior_applied", "")).level).toBe("N4");
    expect(priorCounts().grammar).not.toBe(before.grammar);
    assertBounded(observe("手动换起点"));
  }, 60000);

  it("一级学完往上：语法 N3→N2，备考目标保持 N3", () => {
    expect(levelAdvancePrompt()).toMatchObject({ kind: "grammar", level: "N3", next: "N2" });
    answerLevelAdvance("grammar", "N3", "up");
    expect(readLevelAdvance().grammar.upTo).toBe("N2");
    expect(getStudyPreferences().jlptTarget).toBe("N3");
    expect(scopeLevels(PLAN_GRAMMAR_LEVEL)).toContain("N2");
    assertBounded(observe("一级学完往上"));
  }, 60000);

  it("备考目标改高一级：jlptTarget N3→N2", () => {
    saveStudyPreferences({ ...getStudyPreferences(), jlptTarget: "N2" });
    expect(getLevelPlanSettings()?.target).toBe("N2");
    expect(scopeLevels(PLAN_GRAMMAR_LEVEL)).toEqual(["N5", "N4", "N3", "N2"]);
    assertBounded(observe("备考目标改高一级"));
  }, 60000);

  it("语法种子升版本：ensureSeedData 真正重建后继续正式会话", async () => {
    const reviews = firstValue<number>("SELECT COUNT(*) FROM grammar_reviews", [], 0);
    // 与 grammar-seed.test.ts 相同，只把版本戳置旧来触发生产迁移，不篡改任何 due。
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'pool-guard-old-seed')");
    await ensureSeedData();
    expect(firstValue<string>("SELECT value FROM grammar_state WHERE key='dataset_version'", [], "")).toBe(GRAMMAR_SEED_VERSION);
    expect(firstValue<number>("SELECT COUNT(*) FROM grammar_points_archive WHERE dataset_version='pool-guard-old-seed'", [], 0)).toBeGreaterThan(0);
    expect(firstValue<number>("SELECT COUNT(*) FROM grammar_reviews", [], 0)).toBe(reviews);
    assertBounded(observe("语法种子升版本"));
  }, 60000);

  it("跨设备合并：另一台设备的四类真实作答和先验进入本机", async () => {
    const local = testDb;
    const localPreferences = new Map(preferences);
    const before = priorCounts(false);
    const reviewsBefore = byKind(kind => firstValue<number>(`SELECT COUNT(*) FROM ${PRIOR_ENTITIES[kind].reviews}`, [], 0));
    let remote: Uint8Array;
    try {
      // 两台设备从同一份已同步历史分叉；对端昨天换起点并作答，今天才带回本机。
      // 不能拿完全无关的空库先验覆盖比它更早的真实流水，那会另测成基线冲突。
      at(-1);
      vi.setSystemTime(Date.now() + 3_600_000);
      open(baseline);
      resetDeviceId();
      ensureSyncSchema();
      saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 3, grammarDailyGoal: 3, kanjiDailyGoal: 3,
        confusionDailyGoal: 3, reviewCap: 0, grammarReviewCap: 0, kanjiReviewCap: 0, confusionReviewCap: 0,
        jlptTarget: "N3", jlptPlanEnabled: false });
      await saveLevelPlanSettings({ startingLevel: "N4", familiarity, target: "N3", examDate: "", startedOn: today(), planEnabled: false });
      for (const kind of KINDS) finish(kind, PLAN_GRAMMAR_LEVEL, () => {}, 3);
      remote = await exportSyncSnapshot();
    } finally {
      await vi.dynamicImportSettled();
      testDb.close();
      testDb = local;
      preferences.clear();
      localPreferences.forEach((value, key) => preferences.set(key, value));
      at(0);
    }
    await mergeDatabaseBytes(remote);
    hydrateLevelPlanPreferences();
    for (const kind of KINDS) {
      expect(firstValue<number>(`SELECT COUNT(*) FROM ${PRIOR_ENTITIES[kind].reviews}`, [], 0), `${kind} 对端流水确实进入本机`).toBeGreaterThan(reviewsBefore[kind]);
      expect(priorCounts(false)[kind], `${kind} 合并确实扩大待验证池`).toBeGreaterThan(before[kind]);
    }
    assertBounded(observe("跨设备合并"));
  }, 60000);
});
