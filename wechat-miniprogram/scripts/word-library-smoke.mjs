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
const {
  queryWordLibraryWithDb,
  tallyWordLibraryWithDb,
  wordLibraryDetailWithDb,
  libraryIdsWithDb
} = require('../src/runtime/word-library.js');
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));

const rows = queryWordLibraryWithDb(db, { search: '入口' }, 0, 20);
assert.ok(rows.length > 0 && rows.some((row) => row.kanji === '入口'));
assert.ok(rows.every((row) => row.band === 'unseen'));
const n5 = tallyWordLibraryWithDb(db, { level: 'N5' });
assert.ok(n5.total > 0 && n5.bands.unseen === n5.total);
const detail = wordLibraryDetailWithDb(db, rows.find((row) => row.kanji === '入口').id);
assert.equal(detail.example.jp.length > 0, true);
// 词库详情是只读的：进来不改 FSRS、不进当日计划（判据在网页的 word-library）
assert.equal(typeof detail.note, 'string');
assert.equal(typeof detail.isFavorite, 'boolean');
assert.equal(typeof detail.bandLabel, 'string', '色阶名字来自网页的 bandMeta');
assert.equal(libraryIdsWithDb(db, { level: 'unranked' }, 10).length <= 10, true);
db.close();
console.log(JSON.stringify({ ok: true, search: rows.length, n5: n5.total }, null, 2));
