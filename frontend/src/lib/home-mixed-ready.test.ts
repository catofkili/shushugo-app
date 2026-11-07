import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";

const require = createRequire(import.meta.url);
const stores = require("../../../wechat-miniprogram/src/shared/content-store.js");
let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const prefs = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (key: string) => prefs.get(key) ?? null, setItem: (key: string, value: string) => prefs.set(key, String(value)), removeItem: (key: string) => prefs.delete(key) });
vi.stubGlobal("window", { dispatchEvent: () => true });
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./storage", () => ({ scheduleSave: vi.fn(), requestFullSnapshot: vi.fn() }));
// 执行真实小程序 shim；只把构建器负责的相对路径重定向到同一 content-store / loader。
vi.mock("../data/confusion_distinction_reviews", async () => {
  const { createRequire } = await import("node:module");
  const { readFileSync } = await import("node:fs");
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  new Function("require", "module", readFileSync(new URL("../../../wechat-miniprogram/scripts/shared/shims/distinction-reviews.js", import.meta.url), "utf8"))(
    (name: string) => require(name.includes("content-store") ? "../../../wechat-miniprogram/src/shared/content-store.js" : "../../../wechat-miniprogram/src/shared/content.js"), module
  );
  return module.exports;
});

import { ensureJlptCollocationContent, ensureUserTables, today } from "./study-core";
import { ensureSyncSchema } from "./sync/schema";
import { kanjiCharDataLoaded, loadKanjiCharData } from "./kanji-char-cards";
import { loadMixedCardData, mixedCardCounts, mixedCardDataLoaded, refreshMixedCardTasks } from "./mixed-cards";
import { answerLevelAdvance } from "./level-advance";

beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(async () => {
  prefs.clear();
  stores.distinctionReviews = null;
  db = new SQL.Database(readFileSync(new URL("../../public/nihongo.db", import.meta.url)));
  ensureUserTables();
  ensureSyncSchema();
  await ensureJlptCollocationContent();
});
afterEach(async () => { await vi.dynamicImportSettled(); db.close(); });

it("仅一字多音就绪后在首页升级/恢复强度，清掉旧任务但不把 mixed 误判为 ready", async () => {
  await loadKanjiCharData();
  expect(kanjiCharDataLoaded()).toBe(true);
  expect(mixedCardDataLoaded()).toBe(false);
  db.run("INSERT INTO kanji_char_tasks (reviewed_on,char,order_index) VALUES (?,'日',0)", [today()]);
  db.run("INSERT INTO confusion_tasks (reviewed_on,group_key,order_index) VALUES (?,'stale',0),('2026-01-01','past',0)", [today()]);
  answerLevelAdvance("words", "N3", "up");
  expect(() => refreshMixedCardTasks(db)).not.toThrow();
  expect(db.exec("SELECT COUNT(*) FROM kanji_char_tasks")[0].values).toEqual([[0]]);
  expect(db.exec("SELECT group_key FROM confusion_tasks")[0].values).toEqual([["past"]]);
  expect(db.exec("SELECT COUNT(*) FROM confusion_progress")[0].values).toEqual([[0]]);
  expect(() => mixedCardCounts(db)).toThrow(/未 ready/);
});

it("mixed 自身的 loader 装齐辨析资格后才放行，重排不依赖先进入过学习页", async () => {
  await loadMixedCardData();
  expect(mixedCardDataLoaded()).toBe(true);
  expect(stores.distinctionReviews).not.toBeNull();
  expect(() => refreshMixedCardTasks(db)).not.toThrow();
  expect(mixedCardCounts(db).confusionRemaining).toBeGreaterThan(0);
});
