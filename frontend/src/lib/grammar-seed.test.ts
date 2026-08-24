import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => prefStore.get(k) ?? null,
  setItem: (k: string, v: string) => { prefStore.set(k, String(v)); },
  removeItem: (k: string) => { prefStore.delete(k); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = { dispatchEvent: () => true };

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { ensureSeedData, GRAMMAR_SEED_VERSION } from "./study-core";
import grammarSeed from "../data/grammar_seed.json";

const SQL = await initSqlJs();
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const one = (sql: string) => testDb.exec(sql)[0]?.values?.[0]?.[0];

describe("语法种子升版本", () => {
  beforeEach(() => {
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  });

  /**
   * 这条测试的存在理由：ensureGrammarSeed 只在版本变化时才跑，正常跑测试/开发
   * 时永远走不到。它曾经把 13 个占位符配 14 个列名，真升一次版本会让每个已安装
   * 用户启动时崩在 initDatabase —— 而没有任何测试会发现。
   */
  it("从旧版本升级不会炸，语法点全部重建", async () => {
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'stale-version')");
    await expect(ensureSeedData()).resolves.not.toThrow();

    expect(String(one("SELECT value FROM grammar_state WHERE key='dataset_version'"))).toBe(GRAMMAR_SEED_VERSION);
    // 重建后条数 = 种子 JSON 的行数，而且每一列都真的写进去了
    //（少一个占位符时会直接抛 "13 values for 14 columns"，整个初始化失败）
    expect(Number(one("SELECT COUNT(*) FROM grammar_points"))).toBe(grammarSeed.rows.length);
    expect(Number(one("SELECT COUNT(*) FROM grammar_points WHERE sort_order IS NULL OR sort_order = 0"))).toBe(0);
    expect(Number(one("SELECT COUNT(*) FROM grammar_points WHERE COALESCE(level,'') = ''"))).toBe(0);
  });

  it("用户的语法进度按 pattern 迁移到新 id，不会被重建清掉", async () => {
    const row = testDb.exec("SELECT id, pattern FROM grammar_points ORDER BY sort_order LIMIT 1")[0].values[0];
    const [oldId, pattern] = [Number(row[0]), String(row[1])];
    testDb.run("INSERT OR REPLACE INTO grammar_progress (grammar_id, score, seen_count) VALUES (?, 7, 5)", [oldId]);
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'stale-version')");

    await ensureSeedData();

    const newId = Number(testDb.exec("SELECT id FROM grammar_points WHERE pattern = ?", [pattern])[0].values[0][0]);
    const kept = testDb.exec("SELECT seen_count FROM grammar_progress WHERE grammar_id = ?", [newId])[0];
    expect(kept?.values?.[0]?.[0]).toBe(5);
  });
});
