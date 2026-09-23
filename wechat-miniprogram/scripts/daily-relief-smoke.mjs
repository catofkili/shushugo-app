/*
 * 昨日减负卡：**不写 reviews、不动 FSRS**，只在 app_state 里留今天这一份。
 * 判据在网页的 word-api/daily-relief；这里盯的是小程序接上去之后还是那一份。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const seed = () => new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
const db = seed();

const storage = {};
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/shushugo-relief-smoke' },
  getFileSystemManager: () => ({}),
  getStorageSync: (key) => storage[key] ?? '',
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; }
};
const store = require('../src/runtime/database-store.js');
store.getDatabase = () => db;
store.saveDatabase = async () => ({ bytes: 0 });
await store.ensureContentLoaded();

const core = require('../src/core/study-core.js');
const learning = require('../src/runtime/learning.js');
const { web } = core;
core.ensureStudySchema(db);

// 前一天没有学习就不发减负（不能凭更早的记录发）
const clean = await learning.getStudyHome({ direction: 'forward' });
assert.notEqual(clean.phase, 'relief', '前一天没有学习不能凭更早记录减负');

// 昨天学过 120 个词
const yesterday = web.dbUtils.studyDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
for (let id = 1; id <= 120; id += 1) {
  db.run('UPDATE progress SET seen_count = 1, fsrs_stability = 20, fsrs_due = ?, fsrs_last_review = ? WHERE word_id = ?',
    [new Date(Date.now() + 10 * 86400000).toISOString(), new Date(Date.now() - 86400000).toISOString(), id]);
  db.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction) VALUES (?, 'know', 10, ?, ?, 'forward')",
    [id, yesterday, `${yesterday}T02:00:${String(id % 60).padStart(2, '0')}.000Z`]);
}
// 减负是按天生成、存在 app_state 里的（同网页）：上面那次「没有减负」已经把今天这一份写成空了，
// 清掉它才等于「今天第一次打开」。
db.run("DELETE FROM app_state WHERE key = 'daily_relief_v2'");
const before = Number(db.exec('SELECT COUNT(*) FROM reviews')[0].values[0][0]);

const home = await learning.getStudyHome({ direction: 'forward' });
assert.equal(home.phase, 'relief', '昨天学过就该先发减负卡');
assert.ok(home.card && home.card.relief, '减负卡要带 relief 标记（页面据此不显示评分）');
assert.ok(home.stats.reliefTotal > 0 && home.stats.reliefTotal <= 12, '减负是小份的（6~12 张）');

await learning.answerCard(home.card.id, 'know', { direction: 'forward', relief: true });
assert.equal(Number(db.exec('SELECT COUNT(*) FROM reviews')[0].values[0][0]), before, '看完减负卡不能新增 review');
assert.equal(Number(db.exec('SELECT seen_count FROM progress WHERE word_id = 1')[0].values[0][0]), 1, '看完减负卡不能改变记忆数据');
const after = await learning.getStudyHome({ direction: 'forward' });
assert.equal(after.stats.reliefCompleted, 1, '减负进度只记在 app_state 里');

db.close();
console.log(JSON.stringify({ ok: true, relief: home.stats.reliefTotal }, null, 2));
