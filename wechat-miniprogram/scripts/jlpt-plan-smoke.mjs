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
let navigatedTo = '';
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/shushugo-jlpt-plan-smoke' }, getFileSystemManager: () => ({}),
  getStorageSync: (key) => storage[key] ?? '', setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; }, switchTab: () => {}, navigateTo: ({ url }) => { navigatedTo = url; },
  showShareMenu: () => {}, hideShareMenu: () => {}
};
const store = require('../src/runtime/database-store.js');
store.getDatabase = () => db;
store.getStatus = () => ({ ready: true });
store.saveDatabase = async () => ({});
await store.ensureContentLoaded();
const core = require('../src/core/study-core.js');
core.ensureStudySchema(db);
const unseenInLevels = (levels) => Number(core.firstValue(db, `
  SELECT COUNT(*) FROM words w LEFT JOIN progress p ON p.word_id = w.id
  WHERE (w.jlpt_level IN (${levels.map((level) => `'${level}'`).join(', ')}) OR w.jlpt_level IS NULL OR w.jlpt_level = '')
    AND COALESCE(p.seen_count, 0) = 0 AND COALESCE(p.known_forever, 0) = 0
`, [], 0));
const app = { globalData: {} };
globalThis.getApp = () => app;
let page;
globalThis.Page = (definition) => { page = definition; };
require('../src/pages/index/index.js');
const study = page;
study.data = { ...study.data };
study.setData = (patch) => Object.assign(study.data, patch);
study.showInterleave = () => {};
await study.refreshHome();
assert.equal(navigatedTo, '/features/jlpt-plan/index', '全新学习用户从单词页进入首次设定');
require('../src/features/jlpt-plan/index.js');
page.data = { ...page.data };
page.setData = (patch) => Object.assign(page.data, patch);

await page.onShow();
assert.equal(page.data.setupOpen, true, '全新学习用户进入首次设定');
assert.equal(page.data.hasPlan, false);
assert.equal(page.data.examOptions.length, 4);
assert.equal(page.data.setupPreview.content.words, unseenInLevels(['N5', 'N4', 'N3']), '小程序预设应按词库中真实未学词计算');
page.pickStart({ currentTarget: { dataset: { value: 'kana-none' } } });
page.pickSetupTarget({ currentTarget: { dataset: { value: 'N4' } } });
assert.equal(page.data.setupPreview.content.words, unseenInLevels(['N5', 'N4']), '起点和目标改变后按真实未学记录计算');
await page.saveSetup();
assert.equal(page.data.error, '');
assert.equal(page.data.setupOpen, false);
assert.equal(page.data.hasPlan, true);
assert.equal(page.data.planEstimate.content.words, unseenInLevels(['N5', 'N4']), '计划页的起点预估按真实未学记录计算');
assert.equal(page.data.kanaPending, true);
assert.equal(core.web.preferences.getStudyPreferences().dailyGoal, 0, '五十音未掌握时新词额度暂缓');
assert.equal(core.web.levelPlan.getLevelPlanSettings().target, 'N4');
const card = page.data.kanaCard;
assert.equal(card.choices.length, 4);
assert.ok(card.choices.includes(card.reading));
await page.answerKana({ currentTarget: { dataset: { reading: card.reading } } });
assert.equal(core.web.kanaProgress.getKanaProgress()[card.symbol], 1);
page.openSetup();
page.closeSetup();
assert.equal(page.data.setupOpen, false, '已有计划可取消重新设定');
page.openSetup();
page.pickStart({ currentTarget: { dataset: { value: 'N4' } } });
await page.saveSetup();
core.setState(db, 'jlpt_plan_started_on', '2026-08-01');
const today = new Date();
const reviewedOn = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const n3Ids = core.rowsFor(db, "SELECT p.word_id FROM progress p JOIN words w ON w.id=p.word_id WHERE w.jlpt_level='N3' AND p.seen_count=0 LIMIT 50").map((row) => Number(row.word_id));
for (const id of n3Ids) db.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on,direction) VALUES (?, 'know', 1, ?, 'forward')", [id, reviewedOn]);
await page.onShow();
assert.equal(core.web.levelPlan.effectiveStartingLevel(), 'N3');
assert.equal(core.web.levelPlan.getLevelPlanSettings().startingLevel, 'N4', '自报值不被校准覆盖');
assert.ok(Number(core.firstValue(db, "SELECT COUNT(*) FROM level_prior_baselines b JOIN words w ON w.id=CAST(b.entity_key AS INTEGER) WHERE b.entity='words' AND w.jlpt_level='N3'")) > 0);
let expiryNotices = 0;
wx.showModal = () => { expiryNotices += 1; };
core.setState(db, 'entitlement_cache', JSON.stringify({ isPro: true, source: 'trial', expiresAt: '2020-01-01T00:00:00.000Z' }));
const entitlements = require('../src/runtime/entitlements.js');
assert.equal(entitlements.notifyTrialExpiry(), true);
assert.equal(entitlements.notifyTrialExpiry(), false);
assert.equal(expiryNotices, 1, '同一次到期只提醒一次');
assert.equal(core.web.studyMode.getStudyMode(), 'classic');
db.close();
console.log(JSON.stringify({ ok: true, target: 'N4', kanaStreak: 1 }));
