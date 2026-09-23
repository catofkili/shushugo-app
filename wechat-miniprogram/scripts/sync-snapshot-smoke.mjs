/*
 * 云快照的导出与合并。**导出器和合并器都是网页的 sync/snapshot + sync/merge**，
 * 所以这里不再重测合并规则（那些判据在 frontend 的 merge.test.ts 里），只盯小程序特有的四件事：
 *
 *  1. 导出的还是那个格式（master-nihongo-user-sqlite-v1 / 协议 2），本机登录态和
 *     「本机内容迁到哪一版」的标记绝不出门；
 *  2. 0.1.x 小程序的本地库能升上来：墓碑表换列名、透传表放回真表、自己发明的
 *     direction_tasks / mode_tasks 删掉；
 *  3. 老小程序推上云的那几代快照（墓碑写成 entity/natural_key）里的删除仍然生效；
 *  4. 真实往返：小程序导出 → 小程序合并，收藏 / 成就 / 柚子 / 语法进度一列不少。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const seedPath = path.resolve(root, '../frontend/public/nihongo.db');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const bytes = new Uint8Array(fs.readFileSync(seedPath));
const seed = () => new SQL.Database(bytes);
/** 同步身份里的分隔符（网页那边是 char(31)） */
const UNIT = String.fromCharCode(31);

const storage = {};
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/shushugo-snapshot-smoke' },
  getFileSystemManager: () => ({}),
  getStorageSync: (key) => storage[key] ?? '',
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; }
};
const left = seed();
let current = left;
const store = require('../src/runtime/database-store.js');
store.getDatabase = () => current;
store.saveDatabase = async () => ({ bytes: 0 });
await store.ensureContentLoaded();

const core = require('../src/core/study-core.js');
const learning = require('../src/runtime/learning.js');
const features = require('../src/runtime/extended-features.js');
const grammar = require('../src/runtime/grammar.js');
const { exportSyncSnapshot, mergeSnapshot, SYNC_SNAPSHOT_FORMAT, SYNC_PROTOCOL_VERSION } = require('../src/runtime/sync-snapshot.js');
core.ensureStudySchema(left);

/* ---- 1. 格式，以及不许出门的东西 ---- */
const card = (await learning.getStudyHome({ direction: 'forward' })).card;
await learning.answerCard(card.id, 'know', { direction: 'forward' });
await learning.saveWordNote(card.id, '跨端笔记');
core.setState(left, 'auth_access_token', 'must-not-leave-device');
core.setState(left, 'jlpt_seed_version', 'local-content-marker');
core.setState(left, 'local_snapshot_mark', '2026-09-22T00:00:00.000Z');

const snapshot = await exportSyncSnapshot(left);
const snapshotDb = new SQL.Database(snapshot);
assert.equal(core.firstValue(snapshotDb, 'SELECT format FROM sync_snapshot_meta'), SYNC_SNAPSHOT_FORMAT);
assert.equal(Number(core.firstValue(snapshotDb, 'SELECT protocol_version FROM sync_snapshot_meta')), SYNC_PROTOCOL_VERSION);
assert.equal(core.firstValue(snapshotDb, 'SELECT COUNT(*) FROM app_state WHERE key = ?', ['auth_access_token'], 0), 0,
  '登录态不能进快照');
for (const key of ['jlpt_seed_version', 'local_snapshot_mark']) {
  assert.equal(core.firstValue(snapshotDb, 'SELECT COUNT(*) FROM app_state WHERE key = ?', [key], 0), 0,
    `${key} 说的是本机状态，绝不能跨设备同步`);
}
assert.ok(core.firstValue(snapshotDb, 'SELECT sync_uid FROM reviews LIMIT 1'), '作答必须带 sync_uid');
assert.equal(core.firstValue(snapshotDb, "SELECT COUNT(*) FROM pragma_table_info('sync_tombstones') WHERE name = 'table_name'"), 1);
// grammar_progress 必须逐列齐全：少一列就等于每次推快照都把网页 / iOS 那一列抹掉
const grammarColumns = new Set(core.rowsFor(snapshotDb, "SELECT name FROM pragma_table_info('grammar_progress')").map((row) => String(row.name)));
for (const column of ['grammar_id', 'seen_count', 'known_forever', 'last_seen_on', 'right_count', 'fuzzy_count', 'forgot_count',
  'fsrs_stability', 'fsrs_difficulty', 'fsrs_due', 'fsrs_last_review', 'fsrs_state', 'fsrs_steps', 'fsrs_reps', 'fsrs_lapses']) {
  assert.ok(grammarColumns.has(column), `快照里的 grammar_progress 缺列 ${column}`);
}
snapshotDb.close();

/* ---- 2. 0.1.x 的本地库能升上来 ---- */
const legacy = seed();
legacy.run('CREATE TABLE sync_tombstones (entity TEXT NOT NULL, natural_key TEXT NOT NULL, deleted_at TEXT NOT NULL, PRIMARY KEY (entity, natural_key))');
legacy.run('INSERT INTO sync_tombstones VALUES (?, ?, ?)', ['content_favorites', `word${UNIT}1`, '2026-09-01T00:00:00.000Z']);
legacy.run('CREATE TABLE direction_tasks (study_day TEXT, direction TEXT, word_id INTEGER, order_index INTEGER)');
legacy.run('CREATE TABLE mode_tasks (study_day TEXT, mode TEXT, word_id INTEGER, order_index INTEGER)');
legacy.run('CREATE TABLE sync_passthrough (table_name TEXT PRIMARY KEY, create_sql TEXT, columns_json TEXT, rows_json TEXT, received_at TEXT)');
legacy.run('CREATE TABLE achievements (id TEXT PRIMARY KEY, unlocked_on TEXT NOT NULL)');
legacy.run("INSERT INTO sync_passthrough VALUES ('achievements', '', ?, ?, '2026-09-01')",
  [JSON.stringify(['id', 'unlocked_on']), JSON.stringify([['first-know', '2026-09-01']])]);
current = legacy;
core.ensureStudySchema(legacy);
assert.equal(core.firstValue(legacy, "SELECT COUNT(*) FROM pragma_table_info('sync_tombstones') WHERE name = 'table_name'"), 1,
  '老墓碑表必须换成网页的列名，否则网页的删除触发器往里写会报错、把调用方的事务整个掀翻');
assert.equal(core.firstValue(legacy, "SELECT COUNT(*) FROM sync_tombstones WHERE table_name = 'content_favorites'", [], 0), 1,
  '老墓碑要搬过来，不能丢');
assert.equal(core.firstValue(legacy, "SELECT unlocked_on FROM achievements WHERE id = 'first-know'"), '2026-09-01',
  '透传表里存着的远端行要放回真表，否则这台设备推上去的快照会缺这些表');
for (const table of ['sync_passthrough', 'direction_tasks', 'mode_tasks']) {
  assert.equal(core.firstValue(legacy, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table], 0), 0,
    `${table} 是老小程序自己发明的表，升级后要删掉`);
}
legacy.close();

/* ---- 3. 老格式的远端快照里的删除仍然生效 ---- */
const localWithFavorite = seed();
current = localWithFavorite;
core.ensureStudySchema(localWithFavorite);
localWithFavorite.run("INSERT INTO content_favorites (item_type, item_id) VALUES ('word', '1')");
const legacyRemote = new SQL.Database();
legacyRemote.run('CREATE TABLE sync_snapshot_meta (format TEXT PRIMARY KEY, protocol_version INTEGER NOT NULL)');
legacyRemote.run('INSERT INTO sync_snapshot_meta VALUES (?, ?)', [SYNC_SNAPSHOT_FORMAT, 2]);
// 真实的老快照里这张表是有的（只是那一行被删了），网页的合并器只看它认识且**存在**的表
legacyRemote.run("CREATE TABLE content_favorites (item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at TEXT, folder TEXT NOT NULL DEFAULT '', sync_updated_at TEXT, sync_origin_device TEXT, PRIMARY KEY (item_type, item_id))");
legacyRemote.run("CREATE TABLE sync_tombstones (entity TEXT NOT NULL, natural_key TEXT NOT NULL, deleted_at TEXT NOT NULL, origin_device TEXT NOT NULL DEFAULT '')");
legacyRemote.run('INSERT INTO sync_tombstones VALUES (?, ?, ?, ?)', ['content_favorites', `word${UNIT}1`, '2099-01-01T00:00:00.000Z', 'mini-0.1']);
await mergeSnapshot(localWithFavorite, new Uint8Array(legacyRemote.export()));
assert.equal(core.firstValue(localWithFavorite, "SELECT COUNT(*) FROM content_favorites WHERE item_id = '1'", [], 0), 0,
  '老小程序（entity/natural_key）推上去的删除必须仍然生效，否则用户删掉的收藏会复活');
legacyRemote.close();
localWithFavorite.close();

/* ---- 4. 真实往返：小程序导出 → 小程序合并 ---- */
current = left;
await features.createFavoriteFolder('冲刺');
await features.toggleFavorite('word', card.id, '冲刺');
await grammar.toggleGrammarFavorite(17);
await grammar.markGrammar(17, true);
left.run("INSERT OR IGNORE INTO achievements (id, unlocked_on) VALUES ('first-know', ?)", [core.localStudyDay()]);
left.run("INSERT OR IGNORE INTO yuzu_ledger (kind, key, amount, day) VALUES ('test', 'seed', 25, ?)", [core.localStudyDay()]);
const roundTripSource = await exportSyncSnapshot(left);
const other = seed();
current = other;
core.ensureStudySchema(other);
await mergeSnapshot(other, roundTripSource);
for (const [label, sql] of [
  ['收藏', 'SELECT COUNT(*) FROM content_favorites'],
  ['收藏夹', 'SELECT COUNT(*) FROM favorite_folders'],
  ['成就', 'SELECT COUNT(*) FROM achievements'],
  ['柚子账本', 'SELECT COALESCE(SUM(amount), 0) FROM yuzu_ledger'],
  ['语法进度', 'SELECT COUNT(*) FROM grammar_progress WHERE seen_count > 0'],
  ['语法流水', 'SELECT COUNT(*) FROM grammar_reviews'],
  ['作答流水', 'SELECT COUNT(*) FROM reviews'],
  ['笔记', "SELECT COUNT(*) FROM word_notes WHERE TRIM(note) <> ''"]
]) {
  assert.equal(core.firstValue(other, sql), core.firstValue(left, sql),
    `${label} 必须原样到对端（本机 ${core.firstValue(left, sql)} / 对端 ${core.firstValue(other, sql)}）`);
}
// 语法收藏存的是 grammar.ts 的字符串 id（和网页同一批行）
assert.equal(core.firstValue(other, "SELECT item_id FROM content_favorites WHERE item_type = 'grammar'"), 'pdf-n5-017');
const backAgain = new SQL.Database(await exportSyncSnapshot(other));
assert.equal(core.firstValue(backAgain, 'SELECT COUNT(*) FROM content_favorites'), core.firstValue(left, 'SELECT COUNT(*) FROM content_favorites'),
  '对端再导出一次仍然带着这些行');
backAgain.close();

other.close();
left.close();
console.log(JSON.stringify({ ok: true, bytes: snapshot.byteLength }, null, 2));
