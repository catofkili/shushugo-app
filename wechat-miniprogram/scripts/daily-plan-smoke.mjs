import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
const storage = {};
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/shushugo-daily-plan-smoke' },
  getFileSystemManager: () => ({}),
  getStorageSync: (key) => storage[key] ?? '',
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; },
  createCanvasContext: () => Object.fromEntries(['setLineWidth', 'setStrokeStyle', 'beginPath', 'arc', 'stroke', 'setGlobalAlpha', 'setFillStyle', 'fill', 'setTextAlign', 'setFontSize', 'fillText', 'draw'].map((key) => [key, () => {}]))
};
const store = require('../src/runtime/database-store.js');
store.getDatabase = () => db;
store.getStatus = () => ({ ready: true });
store.saveDatabase = async () => ({});
await store.ensureContentLoaded();
const core = require('../src/core/study-core.js');
core.ensureStudySchema(db);
let page;
globalThis.Page = (definition) => { page = definition; };
require('../src/pages/daily-plan/index.js');
page.data = { ...page.data };
page.setData = (patch) => Object.assign(page.data, patch);
await page.onShow();
assert.equal(page.data.rows.length, 4);
assert.equal(page.data.active.join(','), 'words');

// 保存时必须用页面最初展示的 view；改语法新学不能把未动的单词 cap 400 写成今天的到期数。
const prefs = core.web.preferences.getStudyPreferences();
core.web.preferences.saveStudyPreferences({ ...prefs, reviewCap: 400 });
page.load();
const displayed = page.data.rows[1].fresh;
page.plan.grammar.fresh = displayed + 1;
await page.commit(true);
assert.equal(core.web.preferences.getStudyPreferences().reviewCap, 400);
assert.equal(core.web.preferences.getStudyPreferences().grammarDailyGoal, displayed + 1);
const previousTotal = page.data.total;
page.editTotal({ detail: { value: previousTotal + 2 } });
while (page.data.busy) await new Promise((resolve) => setImmediate(resolve));
assert.equal(page.data.total, previousTotal + 2);
page.undo();
while (page.data.busy) await new Promise((resolve) => setImmediate(resolve));
assert.equal(page.data.total, previousTotal);
assert.ok(Number.isFinite(page.data.presetMinutes));
await page.applyPreset();
assert.equal(page.data.error, '');
assert.equal(core.web.preferences.getStudyPreferences().jlptTarget, page.data.target);
assert.match(page.data.note, /已按 N3 设好/);
db.close();
console.log(JSON.stringify({ ok: true, rows: page.data.rows.length, reviewCap: 400 }));
