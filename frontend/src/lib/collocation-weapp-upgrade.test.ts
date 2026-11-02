import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Database } from "sql.js";
import content from "../data/jlpt_collocation_content.json";

// 与发布小程序相同的 SQLite 胶水和 wasm；不走网页 ensureSeedData。
const require = createRequire(import.meta.url);
const SQL = await require("../../../wechat-miniprogram/src/vendor/sql-wasm.js")({
  wasmBinary: readFileSync(new URL("../../../wechat-miniprogram/src/assets/sql-wasm.wasm", import.meta.url))
});
let db: Database;
const fullSnapshot = vi.fn();
vi.mock("./database", () => ({ getDatabase: () => db, importDatabase: vi.fn() }));
vi.mock("./storage", () => ({
  loadDatabase: async () => true, getLocalDataRevision: () => 0,
  registerPersistenceLifecycle: vi.fn(), saveDatabase: vi.fn(),
  requestFullSnapshot: () => fullSnapshot(), scheduleSave: vi.fn()
}));
vi.mock("../../../wechat-miniprogram/src/config", () => ({ default: {} }));
vi.mock("../../../wechat-miniprogram/src/runtime/wx-promise", () => ({
  downloadFile: vi.fn(), readCompressedFile: vi.fn(), readFile: vi.fn(), removeFile: vi.fn()
}));
vi.mock("../../../taro-spike-2/scripts/taro-content.cjs", () => ({ readyForPage: async () => undefined }));
const state = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => state.get(key) ?? null, setItem: (key: string, value: string) => state.set(key, value), removeItem: (key: string) => state.delete(key) },
  window: { dispatchEvent: () => true }
});
const runtimePath = fileURLToPath(new URL("../../../taro-spike-2/src/platform/database-runtime.weapp.ts", import.meta.url));
const scalar = (sql: string) => db.exec(sql)[0].values[0][0];

beforeEach(() => {
  vi.resetModules();
  fullSnapshot.mockClear();
  db = new SQL.Database(readFileSync(new URL("../../public/nihongo.db", import.meta.url)));
  for (const entry of content.entries) db.run("INSERT INTO words (kanji,kana,meaning,pos,jlpt_level) VALUES (?,?,?,'固定搭配',?)", [entry.surface, entry.kana, entry.meaning, entry.level]);
  db.run("INSERT OR REPLACE INTO app_state (key,value) VALUES ('jlpt_collocation_content_version','2026-10-18-jlpt-collocations-zh-v3')");
});
afterEach(async () => { await vi.dynamicImportSettled(); db.close(); });

it("小程序真实开库入口等待 v3→v4 补齐全部档位后才返回，optional 隐藏且 core 优先", async () => {
  const { ensureDatabase } = await import(runtimePath);
  await expect(ensureDatabase()).resolves.toBe(db);
  expect(scalar("SELECT value FROM app_state WHERE key='jlpt_collocation_content_version'")).toMatch(/-v4$/);
  for (const entry of content.entries) expect(db.exec("SELECT collocation_tier FROM words WHERE pos='固定搭配' AND kanji=? AND kana=?", [entry.surface, entry.kana])[0].values).toEqual([[entry.t ?? 1]]);
  const { optionalWordSql, newWordTierRankSql } = await import("./collocation-tier");
  expect(scalar(`SELECT COUNT(*) FROM words WHERE ${optionalWordSql("id")}`)).toBe(430);
  expect(scalar(`SELECT collocation_tier FROM words ORDER BY ${newWordTierRankSql("id")} LIMIT 1`)).toBe(0);
  expect(fullSnapshot).toHaveBeenCalled();
  fullSnapshot.mockClear();
  await ensureDatabase();
  expect(fullSnapshot).not.toHaveBeenCalled();
});

it("小程序恢复缺档位列的旧备份时也执行 ALTER 和 v4 内容迁移", async () => {
  const backup = db.export();
  db.close();
  db = new SQL.Database(backup);
  expect(db.exec("PRAGMA table_info(words)")[0].values.some((row) => row[1] === "collocation_tier")).toBe(false);
  const { ensureDatabase } = await import(runtimePath);
  await ensureDatabase();
  expect(db.exec("SELECT collocation_tier,COUNT(*) FROM words WHERE pos='固定搭配' GROUP BY collocation_tier ORDER BY collocation_tier")[0].values).toEqual([[0,51],[1,309],[2,430]]);
});

it("小程序档位写入失败不放行数据库、不提前写 v4 标记，撤掉失败后可重试", async () => {
  db.run("CREATE TRIGGER reject_tier BEFORE UPDATE OF collocation_tier ON words BEGIN SELECT RAISE(ABORT,'tier-write-failed'); END");
  const { ensureDatabase } = await import(runtimePath);
  await expect(ensureDatabase()).rejects.toThrow("tier-write-failed");
  expect(scalar("SELECT value FROM app_state WHERE key='jlpt_collocation_content_version'")).toMatch(/-v3$/);
  expect(scalar("SELECT COUNT(*) FROM words WHERE collocation_tier IS NOT NULL")).toBe(0);
  expect(fullSnapshot).not.toHaveBeenCalled();
  db.run("DROP TRIGGER reject_tier");
  await expect(ensureDatabase()).resolves.toBe(db);
  expect(scalar("SELECT COUNT(*) FROM words WHERE collocation_tier IS NOT NULL")).toBe(790);
});
