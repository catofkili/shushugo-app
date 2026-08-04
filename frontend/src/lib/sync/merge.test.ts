import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

vi.mock("../database", () => ({
  getDatabase: () => testDb,
  exportDatabase: () => testDb.export(),
  openDatabase: async (data: Uint8Array) => new SQL.Database(data),
  createDatabase: async () => new SQL.Database(),
  initDatabase: async () => testDb
}));

import { mergeDatabaseBytes } from "./merge";
import { ensureSyncSchema } from "./schema";
import { compressSyncSnapshot, decompressSyncSnapshot, exportSyncSnapshot } from "./snapshot";

const seedPath = fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url));

const rows = (db: Database, sql: string) => {
  const result = db.exec(sql)[0];
  if (!result) return [] as Record<string, unknown>[];
  return result.values.map((value) => Object.fromEntries(
    result.columns.map((column, index) => [column, value[index]])
  ));
};

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  ensureSyncSchema();
});

describe("database snapshot merge", () => {
  it("云同步快照只包含用户数据，不重复打包出厂词典", async () => {
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (1, 10, 1)");
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (1, 'know', 10, '2026-08-03')");
    testDb.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('sync_cursor', 'device-only')");

    const fullBytes = testDb.export();
    const snapshotBytes = await exportSyncSnapshot();
    const snapshot = new SQL.Database(snapshotBytes);
    const tables = new Set(rows(snapshot, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name));

    expect(tables.has("sync_snapshot_meta")).toBe(true);
    expect(tables.has("progress")).toBe(true);
    expect(tables.has("reviews")).toBe(true);
    expect(tables.has("words")).toBe(false);
    expect(tables.has("grammar_points")).toBe(false);
    expect(rows(snapshot, "SELECT key FROM app_state WHERE key = 'sync_cursor'")).toHaveLength(0);
    expect(snapshotBytes.byteLength).toBeLessThan(fullBytes.byteLength / 4);
    snapshot.close();
  });

  it("压缩后的用户快照可无损解压并合并到新设备", async () => {
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (7, 21, 2)");
    testDb.run(`
      INSERT INTO word_study_time_by_device (studied_on, device_id, seconds)
      VALUES ('2026-08-03', 'source-device', 300)
    `);
    const snapshotBytes = await exportSyncSnapshot();
    const compressed = await compressSyncSnapshot(snapshotBytes);
    const repeatedSnapshot = await exportSyncSnapshot();
    const repeatedCompressed = await compressSyncSnapshot(repeatedSnapshot);
    expect(repeatedSnapshot).toEqual(snapshotBytes);
    expect(repeatedCompressed.bytes).toEqual(compressed.bytes);
    const restored = await decompressSyncSnapshot(compressed.bytes, compressed.compression);

    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    ensureSyncSchema();
    testDb.run(`
      INSERT INTO word_study_time_by_device (studied_on, device_id, seconds)
      VALUES ('2026-08-03', 'target-device', 120)
    `);
    await mergeDatabaseBytes(restored);

    expect(rows(testDb, "SELECT word_id, score FROM progress WHERE word_id = 7")).toEqual([
      { word_id: 7, score: 21 }
    ]);
    expect(rows(testDb, `
      SELECT device_id, seconds FROM word_study_time_by_device
      WHERE studied_on = '2026-08-03' ORDER BY device_id
    `)).toEqual([
      { device_id: "source-device", seconds: 300 },
      { device_id: "target-device", seconds: 120 }
    ]);
  });

  it("保留两台设备对不同单词的修改", async () => {
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (1, 10, 1)");
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (2, 20, 1)");

    const remote = new SQL.Database(testDb.export());
    testDb.run("UPDATE progress SET score = 11, seen_count = 2, sync_updated_at = '2030-01-01T00:00:01.000Z' WHERE word_id = 1");
    remote.run("UPDATE progress SET score = 22, seen_count = 2, sync_updated_at = '2030-01-01T00:00:02.000Z', sync_origin_device = 'remote' WHERE word_id = 2");

    await mergeDatabaseBytes(new Uint8Array(remote.export()));
    const result = rows(testDb, "SELECT word_id, score FROM progress WHERE word_id IN (1, 2) ORDER BY word_id");
    expect(result).toEqual([
      { word_id: 1, score: 11 },
      { word_id: 2, score: 22 }
    ]);
  });

  it("复习流水按 sync_uid 取并集", async () => {
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (1, 'know', 5, '2026-08-02')");
    const remote = new SQL.Database(testDb.export());
    remote.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (2, 'fuzzy', 3, '2026-08-02')");

    await mergeDatabaseBytes(new Uint8Array(remote.export()));
    expect(rows(testDb, "SELECT word_id FROM reviews ORDER BY word_id")).toHaveLength(2);
  });

  it("较新的墓碑会阻止旧数据复活", async () => {
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (42, 10, 1)");
    const remote = new SQL.Database(testDb.export());
    testDb.run("DELETE FROM progress WHERE word_id = 42");
    remote.run("UPDATE progress SET sync_updated_at = '2000-01-01T00:00:00.000Z', sync_origin_device = 'remote' WHERE word_id = 42");

    await mergeDatabaseBytes(new Uint8Array(remote.export()));
    expect(rows(testDb, "SELECT word_id FROM progress WHERE word_id = 42")).toHaveLength(0);
    expect(rows(testDb, "SELECT row_key FROM sync_tombstones WHERE table_name = 'progress' AND row_key = '42'")).toHaveLength(1);
  });
});
