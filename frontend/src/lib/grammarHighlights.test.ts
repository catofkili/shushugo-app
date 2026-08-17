import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));

import { ensureUserTables } from "./study-core";
import { ensureSyncSchema } from "./sync/schema";
import {
  addGrammarHighlight,
  clearStaleGrammarHighlights,
  GRAMMAR_HIGHLIGHT_DATASET_VERSION,
  getGrammarHighlightState,
  getGrammarHighlights,
  findGrammarHighlightsInRange,
  invalidateGrammarHighlightCache,
  MAX_HIGHLIGHT_TEXT_LENGTH,
  removeGrammarHighlight,
  removeGrammarHighlightsInRange
} from "./grammarHighlights";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  // 高亮逻辑只依赖用户表，不需要把随包 4MB 词库带进每个用例。
  // 合成最小基础表后由 ensureUserTables 建出 grammar_highlights、同步表等，
  // 测试因此只测高亮/迁移逻辑，不会随正式内容增长变慢或改变输入。
  testDb = new SQL.Database();
  testDb.run(`
    CREATE TABLE words (
      id INTEGER PRIMARY KEY,
      kanji TEXT NOT NULL DEFAULT '',
      kana TEXT NOT NULL DEFAULT '',
      pos TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE reviews (
      id INTEGER PRIMARY KEY,
      reviewed_on TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'forward'
    );
  `);
  ensureUserTables();
});

afterEach(() => testDb.close());

describe("grammar highlights", () => {
  it("写入 SQLite、可取消，并且重复写入不会增加条数", () => {
    const range = { grammarId: "pdf-n3-001", block: "point-example-0", start: 0, end: 2, text: "風か" };
    expect(addGrammarHighlight(range)).toEqual({ ok: true, created: true });
    expect(addGrammarHighlight(range)).toEqual({ ok: true, created: false });
    expect(getGrammarHighlights()).toHaveLength(1);
    expect(removeGrammarHighlight(range)).toEqual({ ok: true, created: false });
    expect(getGrammarHighlights()).toHaveLength(0);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM grammar_highlights")[0].values[0][0])).toBe(0);
  });

  it("内容版本变化时不渲染旧锚点并报告失效数量", () => {
    testDb.run(`
      INSERT INTO grammar_highlights
        (grammar_id, block, start, end, text, dataset_version)
      VALUES ('pdf-n3-001', 'point-example-0', 0, 2, '旧文本', 'before-rewrite')
    `);
    expect(getGrammarHighlights()).toHaveLength(0);
    expect(getGrammarHighlightState().staleCount).toBe(1);
  });

  it("禁止同一块的重点相交，并可用更大的选区一次取消多个重点", () => {
    expect(addGrammarHighlight({ grammarId: "pdf-n3-001", block: "point-example-0", start: 0, end: 3, text: "風かぜ" })).toEqual({ ok: true, created: true });
    expect(addGrammarHighlight({ grammarId: "pdf-n3-001", block: "point-example-0", start: 2, end: 5, text: "ぜで" })).toEqual({ ok: true, created: false });
    expect(addGrammarHighlight({ grammarId: "pdf-n3-001", block: "point-example-0", start: 6, end: 8, text: "重い" })).toEqual({ ok: true, created: true });
    expect(findGrammarHighlightsInRange({ grammarId: "pdf-n3-001", block: "point-example-0", start: 1, end: 7 })).toHaveLength(2);
    expect(removeGrammarHighlightsInRange({ grammarId: "pdf-n3-001", block: "point-example-0", start: 1, end: 7 })).toEqual({ ok: true, created: false });
    expect(getGrammarHighlights().map(({ start, end, text }) => ({ start, end, text }))).toEqual([
      { start: 0, end: 1, text: "風" },
      { start: 7, end: 8, text: "い" }
    ]);
    expect(removeGrammarHighlightsInRange({ grammarId: "pdf-n3-001", block: "point-example-0", start: 0, end: 8 })).toEqual({ ok: true, created: false });
    expect(getGrammarHighlights()).toHaveLength(0);
  });

  it("加载旧数据时也会清掉已经存在的相交重点", () => {
    testDb.run(`
      INSERT INTO grammar_highlights
        (grammar_id, block, start, end, text, dataset_version)
      VALUES
        ('pdf-n3-001', 'point-example-0', 0, 3, '風かぜ', ?),
        ('pdf-n3-001', 'point-example-0', 2, 5, 'ぜで', ?)
    `, [GRAMMAR_HIGHLIGHT_DATASET_VERSION, GRAMMAR_HIGHLIGHT_DATASET_VERSION]);
    expect(getGrammarHighlights()).toHaveLength(1);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM grammar_highlights")[0].values[0][0])).toBe(1);
  });

  it("清理损坏记录并限制总条数，写盘失败不再静默吞掉", () => {
    testDb.run(`
      INSERT INTO grammar_highlights
        (grammar_id, block, start, end, text, dataset_version)
      VALUES ('bad', 'example', -1, 0, '', 'bad')
    `);
    expect(getGrammarHighlightState().totalCount).toBe(0);
    for (let index = 0; index < 500; index += 1) {
      expect(addGrammarHighlight({
        grammarId: "pdf-n3-001",
        block: "point-example-0",
        start: index,
        end: index + 1,
        text: "字"
      }).ok).toBe(true);
    }
    expect(addGrammarHighlight({
      grammarId: "pdf-n3-001",
      block: "point-example-0",
      start: 501,
      end: 502,
      text: "字"
    })).toEqual({ ok: false, reason: "limit" });
  });

  it("拒绝边界外、空文本和超长文本，且失效清理不会碰当前版本", () => {
    const base = { grammarId: "pdf-n3-001", block: "point-example-0", text: "字" };
    expect(addGrammarHighlight({ ...base, start: -1, end: 1 })).toEqual({ ok: false, reason: "invalid" });
    expect(addGrammarHighlight({ ...base, start: 1, end: 1 })).toEqual({ ok: false, reason: "invalid" });
    expect(addGrammarHighlight({ ...base, start: 0, end: 20_001 })).toEqual({ ok: false, reason: "invalid" });
    expect(addGrammarHighlight({ ...base, start: 0, end: 1, text: "" })).toEqual({ ok: false, reason: "invalid" });
    expect(addGrammarHighlight({ ...base, start: 2, end: 3, text: "x".repeat(MAX_HIGHLIGHT_TEXT_LENGTH + 1) })).toEqual({ ok: false, reason: "invalid" });
    testDb.run(`
      INSERT INTO grammar_highlights
        (grammar_id, block, start, end, text, dataset_version)
      VALUES ('pdf-n3-001', 'point-example-0', 3, 4, '旧', 'before-rewrite')
    `);
    invalidateGrammarHighlightCache();
    expect(clearStaleGrammarHighlights()).toBe(1);
    expect(getGrammarHighlights()).toHaveLength(0);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM grammar_highlights")[0].values[0][0])).toBe(0);
    expect(GRAMMAR_HIGHLIGHT_DATASET_VERSION).toContain("2026-08-15-kuromoji-ipadic-v5-bunsetsu");
  });

  it("把旧 localStorage 重点迁移进 SQLite，并保留为失效记录等待用户确认清理", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify([{
        grammarId: "pdf-n3-001",
        block: "point-example-0",
        start: 0,
        end: 2,
        text: "旧重点"
      }])),
      removeItem: vi.fn(),
      setItem: vi.fn()
    };
    vi.stubGlobal("localStorage", storage);
    try {
      const state = getGrammarHighlightState();
      expect(state.highlights).toHaveLength(0);
      expect(state.staleCount).toBe(1);
      expect(storage.removeItem).toHaveBeenCalledWith("jp-grammar-highlights-v1");
      expect(String(testDb.exec("SELECT dataset_version FROM grammar_highlights")[0].values[0][0])).toBe("legacy-unversioned");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("纳入现有同步触发器，取消后会留下墓碑", () => {
    ensureSyncSchema();
    const range = { grammarId: "pdf-n3-001", block: "point-example-0", start: 1, end: 3, text: "かぜ" };
    expect(addGrammarHighlight(range).ok).toBe(true);
    const stamp = testDb.exec("SELECT sync_updated_at FROM grammar_highlights")[0].values[0][0];
    expect(String(stamp)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    removeGrammarHighlight(range);
    const tombstone = testDb.exec("SELECT row_key FROM sync_tombstones WHERE table_name = 'grammar_highlights'");
    expect(String(tombstone[0].values[0][0]).split(String.fromCharCode(31))).toEqual(["pdf-n3-001", "point-example-0", "1", "3"]);
  });
});
