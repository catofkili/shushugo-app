import { expect, it, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const gate = vi.hoisted(() => {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, reached, wait };
});
vi.mock('../database', () => ({
  getDatabase: () => db, exportDatabase: () => db.export(),
  openDatabase: async (bytes: Uint8Array) => new SQL.Database(bytes)
}));
vi.mock('../entitlements', () => ({ canUseFeature: () => false, getEntitlements: () => ({}) }));
vi.mock('../kanji-unit-scheduler', async () => {
  gate.entered(); await gate.wait;
  return { replayKanjiUnitReviews: () => {} };
});
import { ensureSyncSchema } from './schema';
import { mergeDatabaseBytes } from './merge';
it('an answer written while dependencies load retains its sync stamps and latest progress', async () => {
  SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE progress(word_id INTEGER PRIMARY KEY,score INTEGER);
    CREATE TABLE reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,word_id INTEGER,answer TEXT);
    CREATE TABLE kanji_unit_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_key TEXT);
    CREATE TABLE word_study_time(studied_on TEXT PRIMARY KEY,seconds INTEGER,updated_at TEXT);`);
  ensureSyncSchema();
  db.run('INSERT INTO progress VALUES(1,1,NULL,NULL)');
  const remote = new SQL.Database();
  remote.run(`CREATE TABLE sync_snapshot_meta(format TEXT,protocol_version INTEGER);
    INSERT INTO sync_snapshot_meta VALUES('master-nihongo-user-sqlite-v1',2);`);
  const pending = mergeDatabaseBytes(remote.export());
  await gate.reached;
  db.run("INSERT INTO reviews(word_id,answer) VALUES(1,'know')");
  db.run('UPDATE progress SET score=9 WHERE word_id=1');
  gate.release();
  try {
    await pending;
    const row = db.exec('SELECT sync_uid,sync_updated_at,sync_origin_device FROM reviews')[0].values[0];
    expect(row.every(Boolean)).toBe(true);
    expect(db.exec('SELECT score FROM progress WHERE word_id=1')[0].values[0][0]).toBe(9);
  } finally { remote.close(); db.close(); }
});
