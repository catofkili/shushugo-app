import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
const core = require('../src/core/study-core.js');
// 0.1.0 开发版的表名；ensureStudySchema 要把它搬进 achievements 再删掉。
db.run('CREATE TABLE achievement_unlocked (id TEXT PRIMARY KEY, unlocked_on TEXT NOT NULL)');
db.run("INSERT INTO achievement_unlocked VALUES ('first-know', '2026-09-01')");
core.ensureStudySchema(db);
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'achievement_unlocked'"), 0, '旧表必须删掉');
assert.equal(core.firstValue(db, "SELECT unlocked_on FROM achievements WHERE id = 'first-know'"), '2026-09-01', '旧解锁记录要搬进 achievements');

globalThis.wx = { env: { USER_DATA_PATH: '/tmp/shushugo-achievement-smoke' }, getFileSystemManager: () => ({}) };
const store = require('../src/runtime/database-store.js');
store.getDatabase = () => db;
store.saveDatabase = async () => ({});
const { achievementBoard } = require('../src/runtime/achievements.js');
const { web } = require('../src/runtime/extended-features.js');

// 判据和目录来自网页同一份源码：47 条、七类、每条都有可算的进度。
assert.equal(web.achievements.ACHIEVEMENTS.length, 47);
const board = achievementBoard();
assert.equal(board.total, 47);
assert.ok(board.items.every((item) => Number.isFinite(item.progress) && item.progress <= item.goal));
assert.ok(board.items.find((item) => item.id === 'first-know').unlocked, '搬过来的解锁记录要被认出来');
// 网页版目录里的隐藏成就 / 三档稀有度也要一起带过来，页面按它们显示 ??? 和「稀有」
assert.ok(board.items.some((item) => item.hidden));
assert.deepEqual(web.achievements.CATEGORY_ORDER, ['起步', '里程碑', '毅力', '手感', '翻车', '怪癖', '深挖']);
db.close();
console.log(JSON.stringify({ ok: true, total: board.total, unlocked: board.unlocked }, null, 2));
