/*
 * 两台设备的合并。**合并器就是网页的 sync/merge**（按行、墓碑、设备号比较），
 * 这里盯的是小程序接上去之后的行为：不重复插流水、反向记忆也过去、
 * 导入整库备份要换设备号（否则两台设备会生成一模一样的 sync_uid）。
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

const storage = {};
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/shushugo-sync-smoke' },
  getFileSystemManager: () => ({}),
  getStorageSync: (key) => storage[key] ?? '',
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; }
};
const left = new SQL.Database(bytes);
const right = new SQL.Database(bytes);
const store = require('../src/runtime/database-store.js');
let current = left;
store.getDatabase = () => current;
store.saveDatabase = async () => ({ bytes: 0 });
await store.ensureContentLoaded();

const core = require('../src/core/study-core.js');
const learning = require('../src/runtime/learning.js');
const { exportSyncSnapshot, mergeSnapshot } = require('../src/runtime/sync-snapshot.js');
for (const db of [left, right]) core.ensureStudySchema(db);

// left：答一张正向 + 一张反向
const first = await learning.getStudyHome({ direction: 'forward' });
await learning.answerCard(first.card.id, 'know', { direction: 'forward' });
const reverse = await learning.getStudyHome({ direction: 'reverse' });
await learning.answerCard(reverse.card.id, 'know', { direction: 'reverse' });
assert.equal(core.firstValue(left, 'SELECT COUNT(*) FROM reviews'), 2);

// right：自己答一张（不同的词）
current = right;
const rightFirst = await learning.getStudyHome({ direction: 'forward' });
await learning.answerCard(rightFirst.card.id, 'forgot', { direction: 'forward' });

const snapshot = await exportSyncSnapshot(left);
const merged = await mergeSnapshot(right, snapshot);
assert.equal(merged.insertedReviews, 2, '第一遍应新增正向和反向两条流水');
const again = await mergeSnapshot(right, snapshot);
assert.equal(again.insertedReviews, 0, '同一份快照重复合并不得插入重复流水');
assert.equal(core.firstValue(right, 'SELECT COUNT(*) FROM reviews'), 3, '两台设备各自的作答都要在');
assert.equal(core.firstValue(right, 'SELECT seen_count FROM progress WHERE word_id = ?', [first.card.id]), 1);
assert.equal(core.firstValue(right, 'SELECT seen_count FROM reverse_memory WHERE word_id = ?', [reverse.card.id]), 1);
// 作答流水按 sync_uid 认身份（秒级 created_at 撞车时自然键会把两条并成一条）
assert.equal(core.firstValue(right, 'SELECT COUNT(DISTINCT sync_uid) FROM reviews'), 3);

// 导入整库备份要换设备号
const beforeDevice = core.firstValue(right, 'SELECT id FROM sync_device LIMIT 1');
core.withDb(right, () => core.web.syncSchema.resetDeviceId());
assert.notEqual(core.firstValue(right, 'SELECT id FROM sync_device LIMIT 1'), beforeDevice,
  '导入备份后必须换设备号，否则两台设备会生成一模一样的 sync_uid');

left.close();
right.close();
console.log(JSON.stringify({ ok: true, merged, again }, null, 2));
