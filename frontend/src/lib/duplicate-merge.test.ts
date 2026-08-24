/**
 * 重复词条合并的体检。
 *
 * 这一步**不可逆**：删的是词条行。所以这份测试盯的第一件事就是「一条作答都不能丢」，
 * 第二件是「合并完还能正常出题」（没有指向已删行的悬空 word_id）。
 *
 * 默认跑种子库（那里已经没有重复行，验的是「不该动的一行都别动」）。
 * 跑用户真实库快照：
 *   MERGE_DB=../../.local/live.db npx vitest run src/lib/duplicate-merge.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined
};

vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, persistSoon: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import { duplicateMergePlan, mergeDuplicateWords } from "./duplicate-merge";
import { resetConfusionGroups } from "./confusion-groups";
import { ensureProgressInitialized } from "./word-api";

const DB_PATH = process.env.MERGE_DB ?? "../../public/nihongo.db";

const one = (sql: string, params: unknown[] = []) => {
  const result = testDb.exec(sql, params as never)[0];
  return Number(result?.values?.[0]?.[0] ?? 0);
};

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL(DB_PATH, import.meta.url)))));
  prefStore.clear();
  resetConfusionGroups();
  ensureProgressInitialized();
});

describe("重复词条合并", () => {
  it("一条作答都不能丢", () => {
    const before = one("SELECT COUNT(*) FROM reviews");
    const report = mergeDuplicateWords();
    expect(report.reviewsAfter).toBe(before);
    expect(report.reviewsBefore).toBe(before);
  });

  it("合并后没有悬空的 word_id —— 指向已删词条的行会让出题拿到一张不存在的卡", () => {
    mergeDuplicateWords();
    [
      "reviews", "progress", "word_notes", "stage1_tasks", "stage2_progress",
      "kanji_progress", "kanji_memory", "kanji_reading_progress", "kanji_reading_memory", "reverse_memory", "critical_reviews",
      "dictionary_discovered_words", "moji_migrated_reviews"
    ].forEach((table) => {
      const exists = one(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}'`);
      if (!exists) return;
      expect(
        one(`SELECT COUNT(*) FROM ${table} t LEFT JOIN words w ON w.id = t.word_id WHERE w.id IS NULL`),
        `${table} 有指向已删词条的行`
      ).toBe(0);
    });
  });

  it("每个词只剩一行，再跑一次没有可合并的了", () => {
    mergeDuplicateWords();
    resetConfusionGroups();
    expect(duplicateMergePlan().pairs.length).toBe(0);
  });

  it("删掉的行数 = 合并的组数，词库总量对得上", () => {
    const before = one("SELECT COUNT(*) FROM words");
    const plan = duplicateMergePlan();
    const report = mergeDuplicateWords();
    expect(report.merged).toBe(plan.pairs.length);
    expect(one("SELECT COUNT(*) FROM words")).toBe(before - plan.pairs.length);
  });

  it("删行会留下墓碑 —— 否则另一台设备同步回来又把重复行复活", () => {
    const hasTombstones = one("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sync_tombstones'");
    const plan = duplicateMergePlan();
    if (!hasTombstones || !plan.pairs.length) return;
    const before = one("SELECT COUNT(*) FROM sync_tombstones");
    mergeDuplicateWords();
    expect(one("SELECT COUNT(*) FROM sync_tombstones")).toBeGreaterThan(before);
  });

  it("收藏和便签不会因为挂在被合并的那行上而消失", () => {
    const plan = duplicateMergePlan();
    if (!plan.pairs.length) return;
    const pair = plan.pairs[0];
    testDb.run("INSERT OR IGNORE INTO content_favorites (item_type, item_id) VALUES ('word', ?)", [String(pair.fromId)]);
    testDb.run("INSERT OR REPLACE INTO word_notes (word_id, note) VALUES (?, '测试便签')", [pair.fromId]);
    resetConfusionGroups();
    mergeDuplicateWords();
    expect(one("SELECT COUNT(*) FROM content_favorites WHERE item_type='word' AND item_id = ?", [String(pair.intoId)])).toBe(1);
    expect(one("SELECT COUNT(*) FROM word_notes WHERE word_id = ?", [pair.intoId])).toBe(1);
  });
});
