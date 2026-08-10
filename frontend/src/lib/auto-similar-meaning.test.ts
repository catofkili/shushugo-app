import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { rowsFor } from "./database/db-utils";
import { similarMeaningCandidates } from "../data/similar_meaning_groups";
import { buildInterferenceIndex } from "./scheduler/interference";

describe("自动题面撞车组", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
  });

  it("答案面对照卡包含同一题面首义的全部词形", () => {
    const row = rowsFor("SELECT id, kanji, kana, meaning FROM words WHERE id = ?", [224])[0];
    const card = similarMeaningCandidates(row);

    expect(card?.title).toContain("那边");
    expect(new Set(card?.items.map((item) => item.id))).toEqual(
      new Set([223, 302, 2548, 2577, 303])
    );
  });

  it("已有人工组会保留细分说明并补上自动撞车成员", () => {
    const row = rowsFor("SELECT id, kanji, kana, meaning FROM words WHERE id = ?", [760])[0];
    const card = similarMeaningCandidates(row);

    expect(card?.title).toContain("来／去／在");
    expect(card?.items.map((item) => item.id)).toContain(124); // 来る
    expect(card?.distinction).toContain("题面首义相同的其他词");
  });

  it("自动撞车组进入排片干扰索引", () => {
    const rows = rowsFor(
      "SELECT id, kanji, kana, pos, verb_type FROM words WHERE id IN (?, ?)",
      [223, 224]
    );
    const interference = buildInterferenceIndex(rows);

    expect(interference.conflicts(223, 224)).toBe(true);
  });
});
