import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb
}));

import { FSRS_PARAMS_VERSION, recordReviewEvent } from "./reviews";

const rows = (sql: string) => {
  const result = testDb.exec(sql)[0];
  if (!result) return [] as Record<string, unknown>[];
  return result.values.map((value) => Object.fromEntries(result.columns.map((column, index) => [column, value[index]])));
};

beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => { testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath))); });

describe("review event identity", () => {
  it("stores millisecond timing, scheduler metadata, and unique device event ids", () => {
    const first = recordReviewEvent({ wordId: 1, answer: "know", reviewedOn: "2026-08-22", direction: "forward", reviewedAt: 1000 });
    const second = recordReviewEvent({ wordId: 1, answer: "fuzzy", reviewedOn: "2026-08-22", direction: "forward", reviewedAt: 1001 });
    expect(first).not.toBe(second);
    expect(rows("SELECT reviewed_at, scheduler_mode, fsrs_params_version, sync_uid FROM reviews ORDER BY id")).toEqual([
      { reviewed_at: 1000, scheduler_mode: "normal", fsrs_params_version: FSRS_PARAMS_VERSION, sync_uid: expect.stringMatching(/:.+/) },
      { reviewed_at: 1001, scheduler_mode: "normal", fsrs_params_version: FSRS_PARAMS_VERSION, sync_uid: expect.stringMatching(/:.+/) }
    ]);
  });
});
