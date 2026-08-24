import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../src/core/study-core.js');
const relief = require('../src/runtime/daily-relief.js');
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
core.ensureStudySchema(db);
const now = new Date('2026-08-22T12:00:00+08:00');
for (let id = 1; id <= 120; id += 1) {
  db.run('UPDATE progress SET seen_count = 1 WHERE word_id = ?', [id]);
  db.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction) VALUES (?, 'know', 10, '2026-08-21', ?, 'forward')", [id, `2026-08-21T02:00:${String(id % 60).padStart(2, '0')}.000Z`]);
}
const state = relief.ensureDailyRelief(db, now);
assert.equal(state.wordIds.length, 7, '120 个词昨天学习应只给小份减负');
assert.equal(Number(db.exec('SELECT COUNT(*) FROM reviews')[0].values[0][0]), 120);
assert.equal(Number(db.exec('SELECT seen_count FROM progress WHERE word_id = 1')[0].values[0][0]), 1);
relief.advanceDailyRelief(db, now);
assert.equal(Number(db.exec('SELECT COUNT(*) FROM reviews')[0].values[0][0]), 120, '看完减负卡不能新增 review');
assert.equal(Number(db.exec('SELECT seen_count FROM progress WHERE word_id = 1')[0].values[0][0]), 1, '看完减负卡不能改变记忆数据');
const untouched = new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
core.ensureStudySchema(untouched);
assert.equal(relief.ensureDailyRelief(untouched, now).wordIds.length, 0, '前一天没有学习不能凭更早记录减负');
db.close(); untouched.close();
console.log(JSON.stringify({ ok: true, relief: state.wordIds.length }, null, 2));
