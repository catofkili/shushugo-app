import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storage = {};
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/shushugo-smoke' },
  getFileSystemManager: () => ({}),
  getStorageSync: (key) => storage[key] ?? '',
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; }
};
const { ensureGrammarSchema, grammarRows } = require('../src/runtime/grammar.js');
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
ensureGrammarSchema(db);
assert.equal(Number(db.exec('SELECT COUNT(*) FROM grammar_points')[0].values[0][0]), 769);
const n5 = grammarRows(db, '', 'N5', 200);
assert.ok(n5.length > 0 && n5.every((row) => row.level === 'N5'));
const search = grammarRows(db, '名詞1', '', 20);
assert.ok(search.length > 0 && search.some((row) => String(row.pattern).includes('名詞1')));
db.close();
console.log(JSON.stringify({ ok: true, n5: n5.length, search: search.length }, null, 2));
