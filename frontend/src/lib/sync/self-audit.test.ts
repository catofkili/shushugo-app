/** Self-review acceptance probes: failures are unresolved defects, not successful validation. */
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import initSqlJs, { type Database } from 'sql.js';

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const allocated: Database[] = [];
vi.mock('../database', () => ({
  getDatabase: () => testDb,
  exportDatabase: () => testDb.export(),
  openDatabase: async (bytes: Uint8Array) => new SQL.Database(bytes),
  createDatabase: async () => new SQL.Database()
}));
vi.mock('../entitlements', () => ({ canUseFeature: () => false, getEntitlements: () => ({}) }));
import { ensureSyncSchema } from './schema';
import { mergeDatabaseBytes } from './merge';
import { exportSyncSnapshot } from './snapshot';
import { rebuildStudyTimeAggregate } from './study-time';
import { ensureUserTables } from '../study-core';
// 2026-09-23 合入时删掉了四条测小程序旧合并器（sync-snapshot.js 自研 mergeSnapshot）的用例：
// 那套合并器 9-22 已整个换成网页的 mergeDatabaseBytes，小程序和网页现在走同一条路，
// 由下面这些网页用例和 wechat-miniprogram/scripts/sync-snapshot-smoke.mjs 覆盖。
const seed = readFileSync(new URL('../../../public/nihongo.db', import.meta.url));
const makeDb = (bytes: Uint8Array = seed) => {
  const db = new SQL.Database(new Uint8Array(bytes));
  allocated.push(db);
  return db;
};
const value = (db: Database, sql: string) => db.exec(sql)[0]?.values[0]?.[0];
beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => { testDb = makeDb(); ensureUserTables(); ensureSyncSchema(); });
afterEach(() => { for (const db of allocated.splice(0)) db.close(); });

it('study-time aggregate should clear a day after its last detail is deleted', () => {
  testDb.run("INSERT INTO word_study_time_by_device(studied_on,device_id,seconds) VALUES('2030-01-01','a',60)");
  rebuildStudyTimeAggregate();
  testDb.run("DELETE FROM word_study_time_by_device WHERE studied_on='2030-01-01'");
  rebuildStudyTimeAggregate();
  expect(Number(value(testDb, "SELECT COALESCE(SUM(seconds),0) FROM word_study_time WHERE studied_on='2030-01-01'"))).toBe(0);
});

it('a failed later table must roll back progress and release sync context', async () => {
  testDb.run('INSERT INTO progress(word_id,score) VALUES(1,10)');
  const remote = makeDb(await exportSyncSnapshot());
  remote.run("UPDATE progress SET score=90,sync_updated_at='2099-01-01T00:00:00.000Z'");
  remote.run('DROP TABLE word_notes');
  remote.run('CREATE TABLE word_notes(word_id INTEGER PRIMARY KEY,note TEXT,sync_updated_at TEXT,sync_origin_device TEXT)');
  remote.run("INSERT INTO word_notes VALUES(1,NULL,'2099-01-01T00:00:00.000Z','remote')");
  await expect(mergeDatabaseBytes(remote.export())).rejects.toThrow();
  expect(value(testDb, 'SELECT score FROM progress WHERE word_id=1')).toBe(10);
  expect(value(testDb, "SELECT COUNT(*) FROM sync_context WHERE key='applying_remote'")).toBe(0);
});

it('free-account merge preserves unrelated weekly-report tombstones', async () => {
  testDb.run("INSERT INTO sync_tombstones VALUES('weekly_reports','2030-01-01','2030-01-01T00:00:00.000Z','a')");
  await mergeDatabaseBytes(await exportSyncSnapshot());
  expect(value(testDb, "SELECT COUNT(*) FROM sync_tombstones WHERE table_name='weekly_reports'")).toBe(1);
});

it('cloned device ids and auto-increment counters still produce two distinct review identities', async () => {
  const remote = makeDb(testDb.export());
  testDb.run("INSERT INTO reviews(word_id,answer,score_after,reviewed_on) VALUES(1,'know',1,'2030-01-01')");
  remote.run("INSERT INTO reviews(word_id,answer,score_after,reviewed_on) VALUES(2,'know',1,'2030-01-01')");
  expect(value(testDb, 'SELECT sync_uid FROM reviews')).not.toBe(value(remote, 'SELECT sync_uid FROM reviews'));
  await mergeDatabaseBytes(remote.export());
  expect(value(testDb, 'SELECT COUNT(*) FROM reviews')).toBe(2);
});

it('restart keeps deleted time absent while migrating genuine legacy day totals', () => {
  testDb.run("INSERT INTO word_study_time_by_device(studied_on,device_id,seconds) VALUES('2030-01-01','a',60)");
  rebuildStudyTimeAggregate();
  testDb.run("DELETE FROM word_study_time_by_device WHERE studied_on='2030-01-01'");
  // Simulate a crash before aggregate rebuild; the stale total remains in this archive.
  testDb.run("INSERT INTO word_study_time(studied_on,seconds) VALUES('2020-01-01',120)");
  testDb = makeDb(testDb.export());
  ensureSyncSchema();
  rebuildStudyTimeAggregate();
  expect(value(testDb, "SELECT COUNT(*) FROM word_study_time WHERE studied_on='2030-01-01'")).toBe(0);
  expect(value(testDb, "SELECT seconds FROM word_study_time WHERE studied_on='2020-01-01'")).toBe(120);
});

it('unknown business columns still reject the snapshot before mutating progress', async () => {
  const remote = makeDb(await exportSyncSnapshot());
  remote.run('ALTER TABLE progress ADD COLUMN future_business_value TEXT');
  await expect(mergeDatabaseBytes(remote.export())).rejects.toThrow(/无法保留.*列/);
});

it('a previous Pro snapshot does not block ordinary sync after entitlement expires', async () => {
  const remote = makeDb(await exportSyncSnapshot());
  remote.run("CREATE TABLE weekly_reports(week_start TEXT PRIMARY KEY,week_end TEXT,generated_at INTEGER,schema_version INTEGER,content_json TEXT)");
  remote.run("INSERT INTO weekly_reports VALUES('2030-01-01','2030-01-07',1,3,'{}')");
  remote.run("INSERT INTO progress(word_id,score,sync_updated_at) VALUES(1,43,'2090-01-01T00:00:00.000Z')");
  await mergeDatabaseBytes(remote.export());
  expect(value(testDb, 'SELECT score FROM progress WHERE word_id=1')).toBe(43);
  expect(value(testDb, 'SELECT COUNT(*) FROM weekly_reports')).toBe(0);
});

it('old mini-program snapshots with its legacy tables and memory columns still merge', async () => {
  const remote = makeDb(await exportSyncSnapshot());
  remote.run('CREATE TABLE direction_tasks(study_day TEXT, direction TEXT, word_id INTEGER, order_index INTEGER)');
  remote.run("INSERT INTO direction_tasks VALUES('2030-01-01','reverse',1,7)");
  remote.run("INSERT INTO progress(word_id,score,sync_updated_at) VALUES(1,43,'2090-01-01T00:00:00.000Z')");
  await mergeDatabaseBytes(remote.export());
  expect(value(testDb, 'SELECT score FROM progress WHERE word_id=1')).toBe(43);
});
