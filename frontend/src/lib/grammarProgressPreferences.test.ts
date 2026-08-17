import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));

import { ensureUserTables } from "./study-core";
import {
  getGrammarPosition,
  getGrammarScrollPosition,
  saveGrammarPosition,
  saveGrammarScrollPosition
} from "./grammarProgressPreferences";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  ensureUserTables();
});

describe("grammar reading positions", () => {
  it("按语法点 id 保存沉浸式位置，而不是数组下标", () => {
    expect(saveGrammarPosition("immersive", "N3", "pdf-n3-041")).toBe(true);
    expect(getGrammarPosition("immersive", "N3")).toBe("pdf-n3-041");
    expect(String(testDb.exec("SELECT grammar_id FROM grammar_reading_positions")[0].values[0][0])).toBe("pdf-n3-041");
  });

  it("不同等级各自记忆，后续增删语法点不会改写已保存 id", () => {
    saveGrammarPosition("immersive", "N3", "pdf-n3-041");
    saveGrammarPosition("immersive", "N4", "pdf-n4-002");
    expect(getGrammarPosition("immersive", "N3")).toBe("pdf-n3-041");
    expect(getGrammarPosition("immersive", "N4")).toBe("pdf-n4-002");
  });

  it("在当前卡片下保存并恢复列表滚动位置", () => {
    saveGrammarPosition("library", "N3", "pdf-n3-041");
    expect(saveGrammarScrollPosition("library", "N3", 728.5)).toBe(true);
    expect(getGrammarScrollPosition("library", "N3")).toBe(728.5);
    expect(saveGrammarScrollPosition("library", "N3", -1)).toBe(false);
  });
});
