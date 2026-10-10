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

const requestFullSnapshot = vi.fn();
const scheduleSave = vi.fn();
vi.mock("./storage", () => ({
  requestFullSnapshot: () => requestFullSnapshot(),
  scheduleSave: () => scheduleSave(),
  saveRecoverySnapshot: async () => "test"
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
    expect(one("SELECT COUNT(*) FROM words WHERE pos = '固定搭配'")).toBe(790);
    expect(one("SELECT COUNT(*) FROM words WHERE pos = '固定搭配' AND TRIM(meaning) <> ''")).toBe(790);
    expect(one("SELECT COUNT(*) FROM progress p JOIN words w ON w.id = p.word_id WHERE w.pos = '固定搭配'")).toBe(790);
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
    expect(one("SELECT COUNT(*) FROM words WHERE pos = '固定搭配'")).toBe(790);
  });

  it("内容迁移必须要求整库落盘 —— 版本号进增量,内容不进", async () => {
    testDb.run("DELETE FROM app_state");
    testDb.run("DELETE FROM grammar_state WHERE key = 'dataset_version'");
    requestFullSnapshot.mockClear();

    await ensureSeedData();
    // ⚠️ 迁移改的是 words / grammar_points 这些**不带 sync_updated_at、因而不进
    // 增量**的表,而它写下的版本号在 app_state,那张表是进增量的。只调
    // scheduleSave 的话,离下一次整库还有几分钟时重启 = 旧内容 + 新版本号,
    // 而版本门控会让迁移再也不重跑。见 db-utils 的 persistContentSoon。
    expect(requestFullSnapshot).toHaveBeenCalled();
  });

  it("v1 → v2：删掉的搭配没碰过的删行，碰过的标熟知", async () => {
    // 模拟 v1 装过的老库：两条已删的搭配都在，其中一条学过。
    const add = (kanji: string, kana: string) => {
      testDb.run("INSERT INTO words (meaning, kana, kanji, pos, importance, jlpt_level) VALUES ('x', ?, ?, '固定搭配', 3, 'N4')", [kana, kanji]);
      const id = one("SELECT last_insert_rowid()");
      testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [id]);
      return id;
    };
    testDb.run("DELETE FROM app_state");
    testDb.run("DELETE FROM grammar_state WHERE key = 'dataset_version'");
    await ensureSeedData();
    const untouched = add("写真を撮る", "しゃしんをとる");
    const studied = add("時間がかかる", "じかんがかかる");
    const marked = add("約束を守る", "やくそくをまもる");
    testDb.run("UPDATE progress SET seen_count = 3 WHERE word_id = ?", [studied]);
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id = ?", [marked]);
    testDb.run("UPDATE app_state SET value = 'v1' WHERE key = 'jlpt_collocation_content_version'");

    await ensureSeedData();

    expect(one(`SELECT COUNT(*) FROM words WHERE id = ${untouched}`)).toBe(0);
    expect(one(`SELECT COUNT(*) FROM progress WHERE word_id = ${untouched}`)).toBe(0);
    expect(one(`SELECT COUNT(*) FROM words WHERE id IN (${studied}, ${marked})`)).toBe(2);
    expect(one(`SELECT known_forever FROM progress WHERE word_id = ${studied}`)).toBe(1);
    expect(one("SELECT COUNT(*) FROM words WHERE pos = '固定搭配'")).toBe(792);
  });
});
