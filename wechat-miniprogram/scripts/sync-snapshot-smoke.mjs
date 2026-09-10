import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../src/core/study-core.js');
const { exportSyncSnapshot, mergeSnapshot, SYNC_SNAPSHOT_FORMAT } = require('../src/runtime/sync-snapshot.js');
const root = path.resolve(import.meta.dirname, '..');
const seedPath = path.resolve(root, '../frontend/public/nihongo.db');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const bytes = new Uint8Array(fs.readFileSync(seedPath));
const left = new SQL.Database(bytes);
const right = new SQL.Database(bytes);
const now = new Date('2026-08-22T12:00:00+08:00');

for (const db of [left, right]) core.ensureStudySchema(db);
const leftCard = core.nextCard(left, { now });
core.recordAnswer(left, leftCard.id, 'know', { now });
core.saveNote(left, leftCard.id, '跨端笔记', now);
core.setState(left, 'auth_access_token', 'must-not-leave-device');
const snapshot = await exportSyncSnapshot(left);
const repeatedSnapshot = await exportSyncSnapshot(left);
assert.deepEqual(repeatedSnapshot, snapshot, '未发生学习变化时快照应保持幂等，便于服务端重试');
const snapshotDb = new SQL.Database(snapshot);
assert.equal(core.firstValue(snapshotDb, 'SELECT format FROM sync_snapshot_meta'), SYNC_SNAPSHOT_FORMAT);
assert.equal(core.firstValue(snapshotDb, 'SELECT value FROM app_state WHERE key = ?', ['auth_access_token'], 0), 0);
assert.equal(core.firstValue(snapshotDb, 'SELECT COUNT(*) FROM pragma_table_info(\'progress\') WHERE name = \'sync_updated_at\''), 1);
assert.ok(core.firstValue(snapshotDb, 'SELECT sync_updated_at FROM progress WHERE word_id = ?', [leftCard.id]));
assert.equal(core.firstValue(snapshotDb, 'SELECT COUNT(*) FROM pragma_table_info(\'sync_tombstones\') WHERE name = \'table_name\''), 1);
assert.equal(core.firstValue(snapshotDb, 'SELECT COUNT(*) FROM pragma_table_info(\'sync_tombstones\') WHERE name = \'entity\''), 1);
snapshotDb.close();

const merged = mergeSnapshot(right, snapshot);
assert.equal(merged.insertedReviews, 1);
assert.equal(core.firstValue(right, 'SELECT seen_count FROM progress WHERE word_id = ?', [leftCard.id]), 1);
assert.equal(core.firstValue(right, 'SELECT note FROM word_notes WHERE word_id = ?', [leftCard.id]), '跨端笔记');

// 兼容 iOS 旧列名：table_name/row_key 的墓碑应删除小程序本地对应行。
const iosTombstone = new SQL.Database();
iosTombstone.run('CREATE TABLE sync_snapshot_meta (format TEXT PRIMARY KEY, protocol_version INTEGER NOT NULL)');
iosTombstone.run('INSERT INTO sync_snapshot_meta VALUES (?, ?)', [SYNC_SNAPSHOT_FORMAT, 1]);
iosTombstone.run('CREATE TABLE sync_tombstones (table_name TEXT NOT NULL, row_key TEXT NOT NULL, deleted_at TEXT NOT NULL, origin_device TEXT NOT NULL DEFAULT \'\')');
iosTombstone.run('INSERT INTO sync_tombstones VALUES (?, ?, ?, ?)', ['progress', String(leftCard.id), '2026-08-22T12:01:00.000Z', 'ios-test']);
mergeSnapshot(right, new Uint8Array(iosTombstone.export()));
assert.equal(core.firstValue(right, 'SELECT 1 FROM progress WHERE word_id = ?', [leftCard.id], 0), 0);
iosTombstone.close();

// 前端从 fdc44a2 起导出 protocol_version = 2（reviews 多一列 sync_uid）。
// 只认自己那个版本号的话这里会抛「云端学习数据版本不兼容」，v2 的每一次同步全都白跑。
const iosV2 = new SQL.Database();
iosV2.run('CREATE TABLE sync_snapshot_meta (format TEXT PRIMARY KEY, protocol_version INTEGER NOT NULL)');
iosV2.run('INSERT INTO sync_snapshot_meta VALUES (?, ?)', [SYNC_SNAPSHOT_FORMAT, 2]);
iosV2.run('CREATE TABLE reviews (id INTEGER PRIMARY KEY, word_id INTEGER, answer TEXT, score_after INTEGER, reviewed_on TEXT, created_at TEXT, direction TEXT, sync_uid TEXT)');
iosV2.run('INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction, sync_uid) VALUES (?, ?, ?, ?, ?, ?, ?)', [
  leftCard.id, 'know', 0, '2026-08-22', '2026-08-22T05:00:00.000Z', 'forward', 'ios-uid-1'
]);
const mergedV2 = mergeSnapshot(right, new Uint8Array(iosV2.export()));
assert.equal(mergedV2.insertedReviews, 1, 'v2 快照必须能导入');
iosV2.close();

// ── 前端 → 小程序 → 前端 的真实往返 ────────────────────────────────────
// 这里钉住两条曾经静默丢数据的路：
//   ① 同一秒的两次作答（自然键完全相同、sync_uid 不同）不能被去重成一条；
//   ② 小程序还不认识的表（grammar_progress 等）必须原样带回快照 ——
//      Worker 把每次上传当成账号的新完整备份，缺表就是把云端那一代备份削掉一截。
const roundTripDb = new SQL.Database(bytes);
core.ensureStudySchema(roundTripDb);
const sameSecond = new SQL.Database();
sameSecond.run('CREATE TABLE sync_snapshot_meta (format TEXT PRIMARY KEY, protocol_version INTEGER NOT NULL)');
sameSecond.run('INSERT INTO sync_snapshot_meta VALUES (?, ?)', [SYNC_SNAPSHOT_FORMAT, 2]);
sameSecond.run('CREATE TABLE reviews (id INTEGER PRIMARY KEY, word_id INTEGER, answer TEXT, score_after INTEGER, reviewed_on TEXT, created_at TEXT, direction TEXT, sync_uid TEXT)');
for (const uid of ['ios-A:1', 'ios-A:2']) {
  sameSecond.run('INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction, sync_uid) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    leftCard.id, 'know', 0, '2026-08-22', '2026-08-22T06:00:00.000Z', 'forward', uid
  ]);
}
sameSecond.run('CREATE TABLE grammar_progress (grammar_id INTEGER PRIMARY KEY, seen_count INTEGER, forgot_count INTEGER, fsrs_due TEXT)');
sameSecond.run('INSERT INTO grammar_progress VALUES (?, ?, ?, ?)', [17, 4, 1, '2026-09-01T00:00:00.000Z']);
const roundTripMerged = mergeSnapshot(roundTripDb, new Uint8Array(sameSecond.export()));
sameSecond.close();
assert.equal(roundTripMerged.insertedReviews, 2, '同一秒的两次作答必须都进来（身份是 sync_uid，不是 word_id+created_at+direction）');

const roundTripSnapshot = new SQL.Database(await exportSyncSnapshot(roundTripDb));
assert.equal(core.firstValue(roundTripSnapshot, 'SELECT protocol_version FROM sync_snapshot_meta'), 2);
assert.equal(
  core.firstValue(roundTripSnapshot, 'SELECT COUNT(*) FROM reviews WHERE created_at = ?', ['2026-08-22T06:00:00.000Z']),
  2,
  '回传的快照里也必须还是两条'
);
assert.equal(
  core.firstValue(roundTripSnapshot, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'grammar_progress'"),
  1,
  '小程序不认识的表必须原样回传，否则云端最新一代备份缺表'
);
assert.equal(core.firstValue(roundTripSnapshot, 'SELECT seen_count FROM grammar_progress WHERE grammar_id = ?', [17]), 4);
// grammar_progress 现在是正式同步表(不再走透传),所以要多钉两条:
// ① 对端的 FSRS 排期不能在合并里丢掉；② 小程序自己写的进度必须真的出现在导出里。
assert.equal(
  core.firstValue(roundTripSnapshot, 'SELECT fsrs_due FROM grammar_progress WHERE grammar_id = ?', [17]),
  '2026-09-01T00:00:00.000Z',
  '对端排好的语法到期时间必须活着回去'
);
assert.equal(
  core.firstValue(roundTripSnapshot, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sync_passthrough'"),
  0,
  '透传的存放表自己不该出现在快照里'
);
roundTripSnapshot.close();
roundTripDb.close();

// ── 小程序自己写的语法进度 / 收藏必须能同步出去 ────────────────────────────
// K2:grammar_progress 和 grammar_state 以前不在 SNAPSHOT_TABLES 里,而透传只会
// 把「上次收到的远端副本」原样送回 —— 本机新写的一个字都出不去。
const grammarDb = new SQL.Database(bytes);
core.ensureStudySchema(grammarDb);
const grammarRuntime = require('../src/runtime/grammar.js');
grammarDb.run('INSERT OR REPLACE INTO grammar_progress (grammar_id, seen_count) VALUES (?, ?)', [17, 7]);
grammarDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('favorite:17', '1')");
// dataset_version 是本机内容标记,同步出去会让对端跳过语法迁移(见 CLAUDE.md)。
grammarDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'local-only')");
const grammarSnapshot = new SQL.Database(await exportSyncSnapshot(grammarDb));
assert.equal(
  core.firstValue(grammarSnapshot, 'SELECT seen_count FROM grammar_progress WHERE grammar_id = ?', [17], 0),
  7,
  '小程序写的语法进度必须进快照'
);
assert.equal(
  core.firstValue(grammarSnapshot, "SELECT value FROM grammar_state WHERE key = 'favorite:17'", [], ''),
  '1',
  '小程序写的语法收藏必须进快照'
);
assert.equal(
  core.firstValue(grammarSnapshot, "SELECT COUNT(*) FROM grammar_state WHERE key = 'dataset_version'"),
  0,
  'dataset_version 是本机内容标记，绝不能跨设备同步'
);
// 列必须和 iOS 的 grammar_progress 对齐:少一列就等于每次推快照都把 iOS 那一列
// 从云端最新那一代里抹掉(导出只写本机有的列)。
for (const [column] of core.GRAMMAR_PROGRESS_COLUMNS) {
  assert.equal(
    core.firstValue(grammarSnapshot, 'SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?', ['grammar_progress', column]),
    1,
    `快照里的 grammar_progress 缺列 ${column}`
  );
}
grammarSnapshot.close();

// U4:收藏的**写**和**读**必须落在同一张表上。老代码写 app_state(core.setState)、
// 读 grammar_state(grammarRows 的 JOIN),于是点了收藏永远显示不出来。
grammarRuntime.setGrammarState(grammarDb, 'favorite:31', '1');
grammarDb.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('favorite:44', '1')");
grammarRuntime.migrateFavoritesFromAppState(grammarDb);
const grammarList = grammarRuntime.grammarRows(grammarDb, '', '', 800);
const favoriteIds = new Set(grammarList.filter((row) => Number(row.favorite) === 1).map((row) => Number(row.id)));
assert.ok(favoriteIds.has(17), 'grammar_state 里的收藏必须显示出来');
assert.ok(favoriteIds.has(31), '刚写进去的收藏必须立刻读得到（写和读同一张表）');
assert.ok(favoriteIds.has(44), '早先误写进 app_state 的收藏要迁过来，不能就此消失');
assert.equal(
  core.firstValue(grammarDb, "SELECT COUNT(*) FROM app_state WHERE key LIKE 'favorite:%'"),
  0,
  '迁移之后 app_state 里不该再留 favorite: 键'
);
grammarDb.close();

left.close();
right.close();
console.log(JSON.stringify({ ok: true, bytes: snapshot.byteLength, merged }, null, 2));
