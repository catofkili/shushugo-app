import { beforeAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";
import { SYNCED_TABLES } from "./sync/tables";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

vi.mock("./database", () => ({ getDatabase: () => testDb }));
vi.mock("../storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));

import { ensureUserTables } from "./study-core";
import { ensureSyncSchema } from "./sync/schema";

const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

beforeAll(async () => { SQL = await initSqlJs(); });

it("measures cold and warm schema startup on isolated factory database copies", async () => {
  const factoryBytes = new Uint8Array(readFileSync(seedPath));
  const cold = [] as Array<{ sql: number; ms: number; userMs: number; syncMs: number; bytes: number }>;
  let migratedBytes: Uint8Array<ArrayBufferLike> = factoryBytes;

  for (let index = 0; index < 3; index += 1) {
    testDb = new SQL.Database(factoryBytes);
    const counter = instrument(testDb);
    const started = performance.now();
    const userStarted = performance.now();
    ensureUserTables();
    const userMs = performance.now() - userStarted;
    const syncStarted = performance.now();
    ensureSyncSchema();
    const syncMs = performance.now() - syncStarted;
    const bytes = testDb.export();
    cold.push({ sql: counter.count(), ms: performance.now() - started, userMs, syncMs, bytes: bytes.byteLength });
    if (index === 0) migratedBytes = bytes;
    counter.restore();
    testDb.close();
  }

  testDb = new SQL.Database(migratedBytes);
  const originIndexes = testDb.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%_sync_origin_missing'")[0]?.values
    .map(([name]) => String(name)) ?? [];
  for (const name of originIndexes) testDb.run(`DROP INDEX IF EXISTS "${name}"`);
  testDb.run("VACUUM");
  const bytesWithoutOriginIndexes = testDb.export().byteLength;
  testDb.close();

  const warm = [] as Array<{ sql: number; ms: number }>;
  for (let index = 0; index < 3; index += 1) {
    testDb = new SQL.Database(migratedBytes);
    const counter = instrument(testDb);
    const started = performance.now();
    ensureUserTables();
    ensureSyncSchema();
    warm.push({ sql: counter.count(), ms: performance.now() - started });
    counter.restore();
    testDb.close();
  }

  console.info("STARTUP_SCHEMA_METRICS", JSON.stringify({
    factoryBytes: factoryBytes.byteLength,
    migratedBytes: migratedBytes.byteLength,
    growthBytes: migratedBytes.byteLength - factoryBytes.byteLength,
    missingOriginIndexes: originIndexes.length,
    missingOriginIndexNetBytes: migratedBytes.byteLength - bytesWithoutOriginIndexes,
    cold: { medianSql: percentile(cold.map((row) => row.sql), 0.5), medianMs: percentile(cold.map((row) => row.ms), 0.5), medianUserMs: percentile(cold.map((row) => row.userMs), 0.5), medianSyncMs: percentile(cold.map((row) => row.syncMs), 0.5) },
    warm: { medianSql: percentile(warm.map((row) => row.sql), 0.5), medianMs: percentile(warm.map((row) => row.ms), 0.5) },
    coldRuns: cold,
    warmRuns: warm
  }));
  expect(cold).toHaveLength(3);
  expect(warm).toHaveLength(3);
  expect(originIndexes.length).toBe(SYNCED_TABLES.length);
});

function instrument(db: Database) {
  const mutable = db as unknown as {
    run: Database["run"];
    prepare: Database["prepare"];
  };
  const originalRun = mutable.run;
  const originalPrepare = mutable.prepare;
  let sql = 0;
  mutable.run = function (...args: Parameters<Database["run"]>) {
    sql += 1;
    return originalRun.apply(db, args);
  };
  mutable.prepare = function (...args: Parameters<Database["prepare"]>) {
    sql += 1;
    return originalPrepare.apply(db, args);
  };
  return {
    count: () => sql,
    restore: () => {
      mutable.run = originalRun;
      mutable.prepare = originalPrepare;
    }
  };
}
