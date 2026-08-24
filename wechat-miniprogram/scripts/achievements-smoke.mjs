import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CATALOG, boardWithDb } = require('../src/runtime/achievements.js');
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
assert.equal(CATALOG.length, 47);
const board = boardWithDb(db);
assert.equal(board.total, 47);
assert.ok(board.items.every((item) => Number.isFinite(item.progress)));
db.close();
console.log(JSON.stringify({ ok: true, total: board.total, unlocked: board.unlocked }, null, 2));
