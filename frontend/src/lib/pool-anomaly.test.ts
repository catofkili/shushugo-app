/** 用正式会话、设置、先验和同步入口重放；内容只读入内存，网络只检查请求体。 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => vi.stubEnv("VITE_SYNC_API_URL", "https://pool-anomaly.invalid"));
let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const preferences = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => preferences.get(key) ?? null,
  setItem: (key: string, value: string) => preferences.set(key, String(value)),
  removeItem: (key: string) => preferences.delete(key)
});
vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
vi.stubEnv("TZ", "Asia/Singapore");
vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb, exportDatabase: () => testDb.export(),
  openDatabase: async (bytes: Uint8Array) => new SQL.Database(bytes), createDatabase: async () => new SQL.Database()
}));
vi.mock("./storage", () => ({ scheduleSave: vi.fn(), requestFullSnapshot: vi.fn() }));
vi.mock("./database/db-utils", async importOriginal => ({
  ...await importOriginal<typeof import("./database/db-utils")>(), persistSoon: vi.fn(), persistContentSoon: vi.fn()
}));
vi.mock("./useStudyTimer", () => ({ useStudyTimer: vi.fn() }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(), useEffect: vi.fn()
}));
vi.mock("./speech", async importOriginal => ({
  ...await importOriginal<typeof import("./speech")>(), prefetchExamples: vi.fn()
}));

import { ensureUserTables } from "./study-core";
import { firstValue, getState, rowsFor, setState, studyDayEnd, today } from "./database/db-utils";
import { getGrammarQuizSession, PLAN_GRAMMAR_LEVEL, submitGrammarQuizAnswer } from "./grammar-quiz";
import { getWordSession, getWordStats } from "./word-api";
import { getConfusionCardSession, getKanjiCardSession, loadMixedCardData } from "./mixed-cards";
import { pickMixedNext, resetMixedSession } from "./mixed-session";
import { GrammarQuiz } from "../pages/GrammarQuiz";
import type { JLPTLevel } from "../types/grammar";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { defaultStudyPreferences, getStudyPreferences, saveStudyPreferences } from "./studyPreferences";
import { getLevelPlanSettings, hydrateLevelPlanPreferences, recalibrateLevelStartingPoint, saveLevelPlanSettings } from "./level-plan";
import { enforceKanaGate } from "./kana-progress";
import { answerLevelAdvance } from "./level-advance";
import { autoPlanReviewCap, autoReviewCap, recentReviewAverages } from "./review-budget";
import { ensureSyncSchema, resetDeviceId } from "./sync/schema";
import { exportSyncSnapshot } from "./sync/snapshot";
import { mergeDatabaseBytes } from "./sync/merge";
import { isDeviceLocalStateKey } from "./sync/tables";

const START = new Date(2026, 10, 3, 9).getTime();
const at = (offset: number) => vi.setSystemTime(START + offset * 86_400_000);
const fetchMock = vi.fn<typeof fetch>();
const settle = async () => { await vi.dynamicImportSettled(); await new Promise<void>(resolve => setImmediate(resolve)); };
const state = () => JSON.parse(getState("pool_anomaly", "{}"));
const requests = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
const reports = () => requests().map(payload => JSON.parse(payload.message));
const enterMixed = () => {
  resetMixedSession();
  return pickMixedNext({ word: Boolean(getWordSession().card) });
};
// Node 没有 DOM：渲染真实页面，收集并执行挂载 effect；不替换语法会话或诊断入口。
const enterGrammar = async (level: JLPTLevel) => {
  const effects: React.EffectCallback[] = [];
  const effect = vi.mocked(React.useEffect).mockImplementation(callback => { effects.push(callback); });
  try { renderToStaticMarkup(React.createElement(GrammarQuiz, { initialLevel: level, onBack: () => {} })); }
  finally { effect.mockReset(); }
  for (const callback of effects) callback();
  await settle();
};
const open = (bytes: Uint8Array) => {
  testDb = new SQL.Database(bytes);
  (testDb as Database & { create_function(name: string, fn: () => string): void })
    .create_function("current_timestamp", () => new Date().toISOString());
};
let baseline: Uint8Array;
let savedPreferences: Map<string, string>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ accepted: true }) } as Response);
  const storage = await vi.importActual<typeof import("./storage")>("./storage");
  vi.spyOn(storage, "scheduleSave").mockImplementation(() => {});
  vi.spyOn(storage, "requestFullSnapshot").mockImplementation(() => {});
  SQL = await initSqlJs();
  await loadMixedCardData();
  at(-21);
  open(new Uint8Array(readFileSync(new URL("../../public/nihongo.db", import.meta.url))));
  ensureUserTables();
  ensureProgressInitialized();
  saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 3, grammarDailyGoal: 3,
    kanjiDailyGoal: 3, confusionDailyGoal: 3, jlptTarget: "N3", jlptPlanEnabled: false });
  await saveLevelPlanSettings({ startingLevel: "N5", familiarity: { words: 75, grammar: 75, kanji: 75, confusion: 75 },
    target: "N3", examDate: "", planEnabled: false });
  // 前史全部经正式评分写入；用高强度学习过一级的历史检验自然降速，不手写 due。
  for (const row of rowsFor("SELECT id FROM grammar_points WHERE level='N3'")) {
    submitGrammarQuizAnswer("N3", Number(row.id), "know");
  }
  await settle();
  ensureSyncSchema();
  baseline = testDb.export();
  savedPreferences = new Map(preferences);
  testDb.close();
});
beforeEach(() => {
  preferences.clear();
  savedPreferences.forEach((value, key) => preferences.set(key, value));
  at(-1);
  open(baseline);
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ accepted: true }) } as Response);
});
afterEach(async () => { await settle(); testDb.close(); });
afterAll(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/**
 * 模拟「池子被塞进一批卡」：预测时把 N5/N4 先验的 due 挪到很远，expand 时原样放回——
 * 对应范围放开、种子升版、合并等让同一范围的到期池一夜变大的路径。预测和检查用同一个会话范围（计划范围），
 * 因为不同范围的池子本来就不可比（见下面「换会话范围」那条）。
 */
let hidden: { id: number; due: string }[] = [];
async function predict(inject = true) {
  hidden = inject ? rowsFor(`SELECT p.grammar_id AS id, p.fsrs_due AS due FROM grammar_progress p
    JOIN grammar_points g ON g.id = p.grammar_id WHERE g.level IN ('N5','N4') AND p.fsrs_due IS NOT NULL`)
    .map(row => ({ id: Number(row.id), due: String(row.due) })) : [];
  for (const { id } of hidden) testDb.run("UPDATE grammar_progress SET fsrs_due = '2099-01-01T00:00:00.000Z' WHERE grammar_id = ?", [id]);
  enterMixed();
  await settle();
  expect(state().grammar.forecast.forDay).toBe("2026-11-03");
  return state().grammar.forecast.due as number;
}
function inject() {
  for (const { id, due } of hidden) testDb.run("UPDATE grammar_progress SET fsrs_due = ? WHERE grammar_id = ?", [due, id]);
  hidden = [];
}
async function expand() {
  inject();
  enterMixed();
  await settle();
}

describe("截断前到期池的设备本地自检", () => {
  it("10-28 式同范围撑大：先验进池，只报一次且载荷只有统计和固定元数据", async () => {
    const predicted = await predict();
    at(0);
    await expand();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://pool-anomaly.invalid/api/feedback");
    const payload = requests()[0];
    expect(Object.keys(payload).sort()).toEqual(["app_version", "kind", "message", "platform", "route"]);
    expect(payload).toMatchObject({ kind: "error", app_version: __APP_VERSION__, platform: "web", route: "pool-anomaly" });
    const report = reports()[0];
    expect(Object.keys(report).sort()).toEqual(["actual", "cap", "day", "kind", "manual", "merged", "pending", "predicted"]);
    expect(report).toMatchObject({ kind: "grammar", day: today(), predicted, cap: autoPlanReviewCap("grammar"), merged: false, manual: false });
    expect(report.actual).toBeGreaterThanOrEqual(2 * report.cap);
    expect(report.actual - predicted).toBeGreaterThanOrEqual(30);
    expect(report.pending).toBeGreaterThanOrEqual(100);
    expect(JSON.stringify(payload)).not.toMatch(/pattern|meaning|example|grammar_id|word_id|用户输入|～/);
    expect(state().grammar.reported).toBe(today());
    await expand();
    await expand();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("平常自然到期，原有积压超过自动档两倍也不报", async () => {
    const predicted = await predict(false);
    expect(predicted).toBeGreaterThan(2 * autoPlanReviewCap("grammar"));
    at(0);
    await expand();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state().grammar.checked).toBe(today());
  });

  it("换会话范围（昨天只练 N3、今天开计划范围）的池子不比，不报", async () => {
    await enterGrammar("N3");
    expect(state().grammar.forecast.forDay).toBe("2026-11-03");
    expect(state().grammar.forecast.scope).toBe("N3");
    at(0);
    enterMixed();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("单级语法页面进入同级时检查并只报一次，其余三类不触发", async () => {
    await predict();
    await enterGrammar("N5");
    expect(state().grammar.forecast.scope).toBe("N5");
    at(0);
    inject();
    await enterGrammar("N5");
    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toMatchObject({ kind: "grammar", manual: false });
    for (const kind of ["words", "kanji", "confusion"]) expect(state()[kind].checked).toBe("2026-11-02");
    await enterGrammar("N5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("隔三天没打开，没有今天的预测，大量积压不报", async () => {
    at(-3);
    enterMixed();
    await settle();
    expect(state().grammar.forecast.forDay).toBe("2026-11-01");
    at(0);
    await expand();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state().grammar.forecast.forDay).toBe("2026-11-04");
  });

  it.each([
    ["备考目标", { jlptTarget: "N2" as const }],
    ["本类新学量", { grammarDailyGoal: 8 }],
    ["本类复习上限", { grammarReviewCap: 40 }],
    ["考期", { jlptExamDate: "2026-12-06" }],
    ["备考开关", { jlptPlanEnabled: true }],
    ["考试类型", { planExamKind: "jtest" as const }]
  ])("当天手动改%s不报", async (_name, patch) => {
    await predict();
    at(0);
    saveStudyPreferences({ ...getStudyPreferences(), ...patch });
    await expand();
    expect(state().grammar.manual).toBe(today());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["主题", { theme: "dark" as const }],
    ["其他类的新学量", { dailyGoal: 8 }],
    ["原样保存", {}]
  ])("只改%s仍报语法异常", async (_name, patch) => {
    await predict();
    at(0);
    saveStudyPreferences({ ...getStudyPreferences(), ...patch });
    await expand();
    expect(state().grammar.manual).not.toBe(today());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("改新学量后改回：签名相同，照常检查并上报", async () => {
    await predict();
    at(0);
    const prefs = getStudyPreferences();
    saveStudyPreferences({ ...prefs, grammarDailyGoal: 8 });
    saveStudyPreferences(prefs);
    await expand();
    expect(state().grammar.manual).not.toBe(today());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("计划保存原样不打标；只改语法熟悉度仅标语法", async () => {
    await predict();
    at(0);
    const settings = getLevelPlanSettings()!;
    await saveLevelPlanSettings({ ...settings, planEnabled: false });
    await settle();
    expect(state().grammar.manual).not.toBe(today());
    await saveLevelPlanSettings({ ...settings, familiarity: { ...settings.familiarity, grammar: 80 }, planEnabled: false });
    await settle();
    expect(state().grammar.manual).toBe(today());
    expect(state().words?.manual).not.toBe(today());
    expect(state().kanji?.manual).not.toBe(today());
  });

  it("真实首答触发起点重估，四类均标记当天手调并跳过上报", async () => {
    // 自动重估以单词为证据，语法的目标级预测仍单独保留。
    const { submitWordAnswer } = await import("./word-api");
    for (const row of rowsFor("SELECT id FROM words WHERE jlpt_level='N4' AND pos!='固定搭配' LIMIT 50")) {
      setState("current_card", String(row.id));
      submitWordAnswer(Number(row.id), "know", {});
    }
    await settle();
    await predict();
    at(0);
    expect(await recalibrateLevelStartingPoint()).toBe(true);
    await expand();
    for (const kind of ["words", "grammar", "kanji", "confusion"]) expect(state()[kind].manual).toBe(today());
    expect(fetchMock).not.toHaveBeenCalled();
    const cleared = state();
    for (const kind of ["words", "grammar", "kanji", "confusion"]) delete cleared[kind].manual;
    setState("pool_anomaly", JSON.stringify(cleared));
    await saveLevelPlanSettings({ ...getLevelPlanSettings()!, startingLevel: "N4", planEnabled: false });
    await settle();
    for (const kind of ["words", "grammar", "kanji", "confusion"]) expect(state()[kind].manual).toBe(today());
  });

  it("自动假名闸保存时不打标；观测时只跳过单词，语法仍检查", async () => {
    await predict();
    at(0);
    setState("starting_level", "kana-none");
    setState("kana_completed", "0");
    enforceKanaGate();
    await settle();
    expect(getStudyPreferences().dailyGoal).toBe(0);
    expect(state().words?.manual).not.toBe(today());
    await expand();
    expect(state().words.manual).toBe(today());
    expect(state().grammar.manual).not.toBe(today());
    expect(reports().map(report => report.kind)).toEqual(["grammar"]);
  });

  it("一级学完的三种选择都只给对应类打手调标记", async () => {
    for (const choice of ["up", "back", "pause"] as const) {
      setState("pool_anomaly", "{}");
      answerLevelAdvance("grammar", "N3", choice);
      await settle();
      expect(state().grammar.manual).toBe(today());
      expect(state().words).toBeUndefined();
    }
  });

  it("高强度用户学完一级，池子骤降不报", async () => {
    const before = firstValue<number>("SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id=p.grammar_id WHERE g.level='N3' AND p.fsrs_due<=?", [studyDayEnd().toISOString()], 0);
    expect(before).toBeGreaterThan(100);
    // 昨天定好强度并预测；今天正式作答将本级全部学完，不改偏好或 due。
    saveStudyPreferences({ ...getStudyPreferences(), grammarDailyGoal: 30, grammarReviewCap: 200 });
    const predicted = await predict(false);
    at(0);
    const ids = rowsFor("SELECT id FROM grammar_points WHERE level='N3'").map(row => Number(row.id));
    for (const id of ids) submitGrammarQuizAnswer("N3", id, "know");
    await settle();
    expect(firstValue<number>("SELECT COUNT(*) FROM grammar_reviews r JOIN grammar_points g ON g.id=r.grammar_id WHERE g.level='N3' AND r.reviewed_on=?", [today()], 0)).toBeGreaterThan(100);
    enterMixed();
    await settle();
    expect(state().grammar.manual).not.toBe(today());
    expect(state().grammar.forecast.due).toBeLessThan(predicted);
    expect(getGrammarQuizSession("N3").card).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("预测以最后一次混合会话开始为准，同一天实际量只检查一次", async () => {
    const predicted = await predict();
    const session = getGrammarQuizSession(PLAN_GRAMMAR_LEVEL);
    submitGrammarQuizAnswer(PLAN_GRAMMAR_LEVEL, session.card!.id, "know");
    enterMixed();
    await settle();
    expect(state().grammar.forecast.due).toBeLessThan(predicted);
    at(0);
    const sql: string[] = [];
    const prepare = testDb.prepare.bind(testDb);
    vi.spyOn(testDb, "prepare").mockImplementation((query, ...args) => { sql.push(query); return prepare(query, ...args); });
    await expand();
    await expand();
    expect(sql.filter(query => query.includes("AS actual"))).toHaveLength(4);
  });

  it("首页角标不触发诊断，不新增预测 COUNT 或诊断状态写入", async () => {
    const before = getState("pool_anomaly", "{}");
    const sql: string[] = [];
    const prepare = testDb.prepare.bind(testDb);
    vi.spyOn(testDb, "prepare").mockImplementation((query, ...args) => { sql.push(query); return prepare(query, ...args); });
    getWordStats();
    await settle();
    expect(getState("pool_anomaly", "{}")).toBe(before);
    expect(sql.filter(query => /AS predicted|AS actual/.test(query))).toEqual([]);
  });

  it("经典单词与共享底层会话不触发诊断，混合会话开始才观察四类各一次", async () => {
    const before = getState("pool_anomaly", "{}");
    resetMixedSession();
    getWordSession();
    getGrammarQuizSession(PLAN_GRAMMAR_LEVEL);
    getKanjiCardSession(testDb);
    getConfusionCardSession(testDb);
    await settle();
    expect(getState("pool_anomaly", "{}")).toBe(before);
    const sql: string[] = [];
    const prepare = testDb.prepare.bind(testDb);
    vi.spyOn(testDb, "prepare").mockImplementation((query, ...args) => { sql.push(query); return prepare(query, ...args); });
    pickMixedNext({ word: true });
    await settle();
    expect(Object.keys(state()).sort()).toEqual(["confusion", "grammar", "kanji", "words"]);
    expect(state().words.forecast.scope).toBe("{}");
    expect(state().grammar.forecast.scope).toBe(PLAN_GRAMMAR_LEVEL);
    expect(sql.filter(query => query.includes("AS predicted"))).toHaveLength(4);
    pickMixedNext({ word: true });
    await settle();
    expect(sql.filter(query => query.includes("AS predicted"))).toHaveLength(4);
  });

  it("03:59 仍是前一个学习日，边界为凌晨四点", async () => {
    vi.setSystemTime(new Date(2026, 10, 3, 3, 59));
    enterMixed();
    await settle();
    expect(state().grammar.checked).toBe("2026-11-02");
    expect(state().grammar.forecast.forDay).toBe("2026-11-03");
    expect(studyDayEnd().getHours()).toBe(4);
  });

  it.each(["断网抛错", "未登录响应"])("%s不影响调用方，当天记已报不重试", async failure => {
    await predict();
    at(0);
    if (failure === "断网抛错") fetchMock.mockRejectedValue(new Error("离线"));
    else fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: "未登录" }) } as Response);
    inject();
    expect(() => enterMixed()).not.toThrow();
    await settle();
    expect(state().grammar.reported).toBe(today());
    await expand();
    const bytes = testDb.export();
    testDb.close();
    open(bytes);
    await expand();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(preferences.has("mn-pending-feedback-reports")).toBe(false);
  });

  it("四类合并扩池都上报，远端手调和诊断状态不串到本机", async () => {
    saveStudyPreferences({ ...getStudyPreferences(), reviewCap: -1 });
    enterMixed();
    await settle();
    const localState = state();
    for (const kind of ["words", "grammar", "kanji", "confusion"]) expect(localState[kind].forecast.forDay).toBe("2026-11-03");
    const local = testDb;
    const localPrefs = new Map(preferences);
    let remoteBytes: Uint8Array;
    try {
      open(baseline);
      resetDeviceId(); ensureSyncSchema();
      at(-19);
      await saveLevelPlanSettings({ ...getLevelPlanSettings()!, startingLevel: "N4", planEnabled: false });
      at(-1);
      saveStudyPreferences({ ...getStudyPreferences(), reviewCap: -1 });
      setState("pool_anomaly", JSON.stringify({ grammar: { manual: "2026-11-03", forecast: { forDay: "2026-11-03", due: 999999, merged: false } } }));
      remoteBytes = await exportSyncSnapshot();
      const snapshot = new SQL.Database(remoteBytes);
      expect(snapshot.exec("SELECT value FROM app_state WHERE key='pool_anomaly'")).toEqual([]);
      // 导入一侧也必须挡：旧版本/整库快照可能仍带着这个本地键。
      snapshot.run("INSERT INTO app_state (key,value) VALUES ('pool_anomaly',?)", [getState("pool_anomaly", "{}")]);
      remoteBytes = snapshot.export(); snapshot.close();
    } finally {
      await settle(); testDb.close(); testDb = local;
      preferences.clear(); localPrefs.forEach((value, key) => preferences.set(key, value));
    }
    at(0);
    await mergeDatabaseBytes(remoteBytes!);
    hydrateLevelPlanPreferences();
    await settle();
    expect(isDeviceLocalStateKey("app_state", "pool_anomaly")).toBe(true);
    expect(state().grammar.forecast.due).toBe(localState.grammar.forecast.due);
    expect(state().grammar.forecast.merged).toBe(true);
    expect(state().grammar.manual).not.toBe(today());
    enterMixed(); await settle();
    expect(getStudyPreferences().reviewCap).toBe(-1);
    expect(reports().map(report => report.kind).sort()).toEqual(["confusion", "grammar", "kanji", "words"]);
    for (const report of reports()) {
      expect(report).toMatchObject({ merged: true, manual: false });
      expect(report.actual - report.predicted).toBeGreaterThanOrEqual(30);
      expect(report.cap).toBe(report.kind === "words" ? autoReviewCap(recentReviewAverages().avgDailyWords) : autoPlanReviewCap(report.kind));
    }
  });
});
