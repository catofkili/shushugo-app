import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../src/core/study-core.js');
const { buildEnvelope, applyEnvelope } = require('../src/core/sync-protocol.js');
const root = path.resolve(import.meta.dirname, '..');
const seedPath = path.resolve(root, '../frontend/public/nihongo.db');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const bytes = new Uint8Array(fs.readFileSync(seedPath));
const left = new SQL.Database(bytes);
const right = new SQL.Database(bytes);
const now = new Date('2026-08-22T12:00:00+08:00');

for (const db of [left, right]) {
  core.ensureStudySchema(db);
  core.createTodayPlan(db, { now, reviewLimit: 0, newLimit: 3 });
}
const leftCard = core.nextCard(left, { now });
core.recordAnswer(left, leftCard.id, 'know', { now });
const leftReverse = core.nextCard(left, { now, direction: 'reverse', directionLimit: 1 });
core.recordAnswer(left, leftReverse.id, 'know', { now, direction: 'reverse' });
core.nextCard(right, { now });
const rightCard = core.nextCard(right, { now });
core.recordAnswer(right, rightCard.id, 'forgot', { now });

const envelope = buildEnvelope(left);
const firstMerge = applyEnvelope(right, envelope);
const secondMerge = applyEnvelope(right, envelope);
assert.equal(firstMerge.insertedReviews, 2, '第一遍应新增正向和反向两条流水');
assert.equal(secondMerge.insertedReviews, 0, '相同自然键重复同步不得插入重复流水');
assert.equal(core.firstValue(right, 'SELECT COUNT(*) FROM reviews'), 3);
assert.equal(core.firstValue(right, 'SELECT seen_count FROM progress WHERE word_id = ?', [leftCard.id]), 1);
assert.equal(core.firstValue(right, 'SELECT seen_count FROM reverse_memory WHERE word_id = ?', [leftReverse.id]), 1);
assert.throws(() => applyEnvelope(right, { ...envelope, checksum: 'tampered' }), /校验和/);

left.close();
right.close();
console.log(JSON.stringify({ ok: true, firstMerge, secondMerge, checksum: envelope.checksum }, null, 2));
