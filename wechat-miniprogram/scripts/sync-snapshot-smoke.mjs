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

left.close();
right.close();
console.log(JSON.stringify({ ok: true, bytes: snapshot.byteLength, merged }, null, 2));
