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

import { ensureSeedData } from "./study-core";

const SQL = await initSqlJs();
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const one = (sql: string) => Number(testDb.exec(sql)[0]?.values?.[0]?.[0] ?? 0);

/**
 * study-core 里有 8 条**版本门控**的迁移：`if (getState(...) === XXX_VERSION) return;`
 * 它们只在常量变化时才执行，所以在日常开发、CI、以及绝大多数用户的机器上
 * **一次都不会跑**。
 *
 * 2026-08-23 的教训：`ensureGrammarSeed` 里那条 INSERT 写下来就是 14 列配 13 个
 * 占位符，从没执行过，也就没人发现。真升一次版本 = 每个已安装用户启动时崩在
 * initDatabase（「本地词库读取失败」），一次内容更新把所有人的 App 变砖。
 *
 * 这条测试把所有版本戳清空，强行让**每一条**迁移都真的跑一遍。它不检查迁移做得
 * 对不对（那是各自的事），只保证「升版本」这个动作本身不会炸 —— 而这正是那次
 * 事故里缺的那一格。加新的版本门控迁移时不用改这里，清空即可自动覆盖到。
 */
describe("冷启动：所有版本门控的迁移都要能真的跑一遍", () => {
  beforeEach(() => {
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  });

  it("清空全部版本戳后重跑 ensureSeedData 不炸", async () => {
    const words = one("SELECT COUNT(*) FROM words");
    const grammar = one("SELECT COUNT(*) FROM grammar_points");
    expect(words).toBeGreaterThan(10000);
    expect(grammar).toBeGreaterThan(700);

    // 每一条门控读的都是 app_state / grammar_state 里的一个版本戳
    testDb.run("DELETE FROM app_state");
    testDb.run("DELETE FROM grammar_state WHERE key = 'dataset_version'");

    await expect(ensureSeedData()).resolves.not.toThrow();

    // 跑完之后词库和语法都还在（迁移炸掉时事务回滚，这两个数会塌）
    expect(one("SELECT COUNT(*) FROM words")).toBeGreaterThanOrEqual(10000);
    expect(one("SELECT COUNT(*) FROM grammar_points")).toBeGreaterThan(700);
    // 版本戳被重新写回去了 = 迁移确实执行到了收尾，不是提前 return
    expect(one("SELECT COUNT(*) FROM app_state")).toBeGreaterThan(0);
  });

  it("连着跑两次是幂等的（第二次应该全部提前 return）", async () => {
    testDb.run("DELETE FROM app_state");
    testDb.run("DELETE FROM grammar_state WHERE key = 'dataset_version'");
    await ensureSeedData();
    const after = one("SELECT COUNT(*) FROM grammar_points");
    await expect(ensureSeedData()).resolves.not.toThrow();
    expect(one("SELECT COUNT(*) FROM grammar_points")).toBe(after);
  });
});
