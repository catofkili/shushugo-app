import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
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
assert.equal(typeof detail.exampleFurigana, 'string');
assert.equal(libraryIdsWithDb(db, { level: 'unranked' }, 10).length <= 10, true);
db.close();
console.log(JSON.stringify({ ok: true, search: rows.length, n5: n5.total }, null, 2));
