import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";
import baseline from "./__fixtures__/home-mode-counts-baseline.json";
import type { StudyMode } from "../types/app";

let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const prefs = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (key: string) => prefs.get(key) ?? null, setItem: (key: string, value: string) => prefs.set(key, String(value)), removeItem: (key: string) => prefs.delete(key) });
vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./storage", () => ({ scheduleSave: vi.fn(), requestFullSnapshot: vi.fn() }));
vi.mock("./database/db-utils", async (original) => ({ ...await original<typeof import("./database/db-utils")>(), persistSoon: vi.fn() }));

import { ensureJlptCollocationContent, ensureUserTables, today } from "./study-core";
import { ensureSyncSchema } from "./sync/schema";
import { getWordStats } from "./word-api/stats";
import * as mixed from "./mixed-cards";
import * as confusion from "./confusion-cards";
import * as kanji from "./kanji-char-cards";
import { readyForHomeMode } from "./content-ready";

beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(async () => {
  prefs.clear();
  db = new SQL.Database(readFileSync(new URL("../../public/nihongo.db", import.meta.url)));
  ensureUserTables();
  ensureSyncSchema();
  await ensureJlptCollocationContent();
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });

it("classic 首页与 quick 只读当前数，不调用 mixedCardCounts 或 materializeConfusionCards", async () => {
  const counts = vi.spyOn(mixed, "mixedCardCounts");
  const materialize = vi.spyOn(confusion, "materializeConfusionCards");
  await readyForHomeMode("classic");
  const stats = getWordStats();
  expect(stats.modeCounts.classic).toBe(baseline.counts.first.classic);
  expect(stats.modeCounts.quick).toBe(stats.modeCounts.classic);
  expect(counts).toHaveBeenCalledTimes(0);
  expect(materialize).toHaveBeenCalledTimes(0);
  expect(db.exec("SELECT COUNT(*) FROM confusion_progress")[0].values[0][0]).toBe(0);
});

it("classic 冷开未装 mixed 资格时改额度，仍清除旧的今日投影，不消费内容或改历史", () => {
  expect(mixed.mixedCardDataLoaded()).toBe(false);
  const materialize = vi.spyOn(confusion, "materializeConfusionCards");
  db.run("INSERT INTO kanji_char_tasks (reviewed_on, char, order_index) VALUES (?, '日', 0)", [today()]);
  db.run("INSERT INTO confusion_tasks (reviewed_on, group_key, order_index) VALUES (?, 'stale', 0)", [today()]);
  db.run("INSERT INTO confusion_tasks (reviewed_on, group_key, order_index) VALUES ('2026-01-01', 'past', 0)");
  mixed.refreshMixedCardTasks(db);
  expect(db.exec("SELECT COUNT(*) FROM kanji_char_tasks")[0].values[0][0]).toBe(0);
  expect(db.exec("SELECT group_key FROM confusion_tasks")[0].values).toEqual([["past"]]);
  expect(db.exec("SELECT COUNT(*) FROM confusion_reviews")[0].values[0][0]).toBe(0);
  expect(materialize).not.toHaveBeenCalled();
});

it("出厂库每个模式与改前全量计算一致；重开快照后仍一致；每个 getter 只算一次", async () => {
  await readyForHomeMode("mixed");
  await readyForHomeMode("kanji");
  const counts = vi.spyOn(mixed, "mixedCardCounts");
  for (const kind of ["first", "cold"] as const) {
    const stats = getWordStats();
    for (const [mode, expected] of Object.entries(baseline.counts[kind])) {
      expect(stats.modeCounts[mode as StudyMode], `${kind}/${mode}`).toBe(expected);
    }
    expect({ ...stats.modeCounts }).toEqual(baseline.counts[kind]);
    if (kind === "first") { const bytes = db.export(); db.close(); db = new SQL.Database(bytes); }
  }
  expect(counts).toHaveBeenCalledTimes(2);
});

it("首次设定/首页改计划只重排任务，不生成需要完整读音和题面内容的卡", async () => {
  await readyForHomeMode("mixed");
  // 改前重排调用两个 session；保留其真实任务清单作对照，不能只比较数量。
  mixed.getKanjiCardSession(db);
  mixed.getConfusionCardSession(db);
  // 两次真实重排的同步时间戳自然不同；对照学习日、内容身份和顺序。
  const tasks = () => [["kanji_char_tasks", "char"], ["confusion_tasks", "group_key"]]
    .map(([table, key]) => db.exec(`SELECT reviewed_on, ${key}, order_index FROM ${table} ORDER BY order_index`));
  const before = tasks();
  const kanjiCard = vi.spyOn(kanji, "kanjiCharCard");
  const matchingCard = vi.spyOn(confusion, "matchingCard");
  mixed.refreshMixedCardTasks(db);
  expect(kanjiCard).not.toHaveBeenCalled();
  expect(matchingCard).not.toHaveBeenCalled();
  expect(tasks()).toEqual(before);
  expect(getWordStats().modeCounts.mixed).toBe(baseline.counts.first.mixed);
});
