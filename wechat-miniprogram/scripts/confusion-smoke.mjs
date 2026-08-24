import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { allGroups, queryConfusionGroupsWithDb, confusionSummaryWithDb } = require('../src/runtime/confusion.js');
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
const groups = allGroups(db);
assert.equal(groups.length, 1912, `辨析组数异常: ${groups.length}`);
assert.ok(groups.some((group) => group.type === 'pair'));
assert.ok(queryConfusionGroupsWithDb(db, '入口', '', 0, 10).length > 0);
assert.equal(confusionSummaryWithDb(db).total, groups.length);
db.close();
console.log(JSON.stringify({ ok: true, groups: groups.length }, null, 2));
