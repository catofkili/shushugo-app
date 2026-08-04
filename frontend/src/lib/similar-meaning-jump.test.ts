import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const prefStore = new Map<string, string>();

(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
};

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));
vi.mock("./progress-events", () => ({
  PROGRESS_UPDATED_EVENT: "test",
  notifyProgressUpdated: () => undefined
}));

import { ensureProgressInitialized, jumpToSimilarWord } from "./word-api";
import { getState, setState, today } from "./database/db-utils";

describe("相似释义词传送", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
    ensureProgressInitialized();
  });

  it("静默把当前词记为模糊，并把目标词设为当前卡", () => {
    const currentWordId = 760; // いらっしゃる
    const targetWordId = 1708; // おいでになる
    const studyDate = today();

    testDb.run("DELETE FROM reviews");
    testDb.run("DELETE FROM stage1_tasks");
    setState("phase_date", studyDate);
    setState("phase", "stage1");
    setState("current_card", String(currentWordId));

    const before = Number(testDb.exec(
      `SELECT fuzzy_count FROM progress WHERE word_id=${currentWordId}`
    )[0].values[0][0]);

    const result = jumpToSimilarWord(currentWordId, targetWordId);

    const after = Number(testDb.exec(
      `SELECT fuzzy_count FROM progress WHERE word_id=${currentWordId}`
    )[0].values[0][0]);
    const answer = String(testDb.exec(
      `SELECT answer FROM reviews WHERE word_id=${currentWordId} ORDER BY id DESC LIMIT 1`
    )[0].values[0][0]);

    expect(after).toBe(before + 1);
    expect(answer).toBe("fuzzy");
    expect(result.card?.id).toBe(targetWordId);
    expect(getState("current_card", "0")).toBe(String(targetWordId));
  });
});
