/*
 * 学习模式。模式清单和「进去之后还能练多少」的角标都来自网页的 studyMode / WordStats.modeCounts，
 * 小程序不另建一套。快速学习是批次评分（和网页的 QuickStudyPanel 同一条路）。
 */
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
const soundFiles = new Map();
const playedSounds = [];
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/shushugo-modes-smoke' },
  getFileSystemManager: () => ({ writeFileSync: (file, bytes) => soundFiles.set(file, bytes) }),
  createInnerAudioContext: () => ({ stop() {}, set src(file) { this.file = file; }, play() { playedSounds.push(this.file); } }),
  getStorageSync: (key) => storage[key] ?? '',
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; }
};
const app = { globalData: {} };
globalThis.getApp = () => app;
let switchedTo = '';
wx.switchTab = ({ url }) => { switchedTo = url; };
let toast = '';
wx.showToast = ({ title }) => { toast = title; };
const store = require('../src/runtime/database-store.js');
store.getDatabase = () => db;
store.saveDatabase = async () => ({ bytes: 0 });
await store.ensureContentLoaded();

const core = require('../src/core/study-core.js');
const learning = require('../src/runtime/learning.js');
const { web } = core;
core.ensureStudySchema(db);

// 模式清单就是网页那六个（自选是隐藏模式，不摆进列表）
const modes = web.studyMode.VISIBLE_STUDY_MODES.map((mode) => mode.id);
assert.deepEqual(modes, ['classic', 'mixed', 'mistakes', 'quick', 'reverse', 'kanji'], '模式清单必须和网页一致');

// 单词是 tab 页，模式入口必须 switchTab 并把选择交给学习页的 onShow。
let page;
globalThis.Page = (definition) => { page = definition; };
require('../src/pages/modes/index.js');
page.startMode({ currentTarget: { dataset: { mode: 'mixed' } } });
assert.equal(switchedTo, '', '免费账户不能开始混合学习');
assert.match(toast, /Pro/);
core.setState(db, 'entitlement_cache', JSON.stringify({ isPro: true, source: 'trial', expiresAt: '2099-01-01T00:00:00.000Z' }));
page.startMode({ currentTarget: { dataset: { mode: 'mixed' } } });
assert.equal(switchedTo, '/pages/index/index');
assert.equal(app.globalData.pendingStudyMode, 'mixed');
store.getStatus = () => ({ ready: true });
require('../src/pages/index/index.js');
page.data = { ...page.data };
page.setData = (patch) => Object.assign(page.data, patch);
page.refreshHome = () => {};
page.onShow();
assert.equal(page.data.mode, 'mixed');
assert.equal(page.data.direction, 'forward');
assert.equal(app.globalData.pendingStudyMode, undefined);

// 经典模式
const classic = await learning.getStudyHome({ mode: 'classic' });
assert.ok(classic.card, '经典模式应能出卡');
assert.ok(classic.stats.modeCounts, '角标（每个模式还能练多少）来自网页的 WordStats');

// 触摸只负责 UI：没翻面、纵向滚动、距离不足都不能给学习流水记分。
page.data.card = classic.card;
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], target: { dataset: {} } });
const submitted = [];
page.handleAnswer = (event) => submitted.push(event.currentTarget.dataset.answer);
page.wordTouchStart(touch(10, 10));
page.wordTouchMove(touch(140, 10));
page.wordTouchEnd();
assert.deepEqual(submitted, []);
page.data.answerVisible = true;
page.wordTouchStart(touch(10, 10));
page.wordTouchMove(touch(20, 120));
page.wordTouchEnd();
page.wordTouchStart(touch(10, 10));
page.wordTouchMove(touch(70, 10));
page.wordTouchEnd();
assert.deepEqual(submitted, []);
page.wordTouchStart(touch(10, 10));
page.wordTouchMove(touch(140, 10));
page.wordTouchEnd();
await new Promise((resolve) => setTimeout(resolve, 280));
assert.deepEqual(submitted, ['know']);
page.wordTouchStart(touch(140, 10));
page.wordTouchMove(touch(10, 10));
page.wordTouchEnd();
await new Promise((resolve) => setTimeout(resolve, 280));
assert.deepEqual(submitted, ['know', 'forgot']);
page.pushUndo('word');
page.pushUndo('grammar');
page.pushUndo('kanji');
assert.deepEqual(page.data.undoKinds, ['grammar', 'kanji']);
page.popUndo();
assert.deepEqual(page.data.undoKinds, ['grammar']);

web.sounds.playFlip();
web.sounds.playKnow(12);
assert.equal(playedSounds.length, 2);
assert.equal(String.fromCharCode(...new Uint8Array(soundFiles.get(playedSounds[0]), 0, 4)), 'RIFF');

// 快速学习：批次评分走 submitQuickStudyBatch，流水和正式作答一视同仁
const quickCard = classic.card;
await learning.answerCard(quickCard.id, 'know', { mode: 'quick' });
assert.equal(Number(db.exec("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'")[0].values[0][0]), 1);
assert.equal(Number(db.exec("SELECT COUNT(*) FROM reviews WHERE event_source = 'study'")[0].values[0][0]), 1,
  '快速学习写的是正常学习流水（不是 bulk_complete）');

// 错题本：只换选词通道，不进今日计划
const mistakes = await learning.getStudyHome({ mode: 'mistakes' });
assert.equal(typeof mistakes.stats.planned, 'number');
assert.ok(mistakes.stats.planned >= 0);



/* ---- 混合模式：每答 5 个单词插一张别的卡，三种轮着来 ---- */
// 出的是网页那同一副牌（grammar-quiz / mixed-cards），所以在哪边答的都算数。
const mixedSeen = new Set();
let words = 0;
let rewindChecked = false;
for (let step = 0; step < 24; step += 1) {
  const home = await learning.getStudyHome({ mode: 'mixed' });
  if (home.interleave) {
    const kind = home.interleave.kind;
    mixedSeen.add(kind);
    const id = kind === 'grammar' ? home.interleave.card.id : kind === 'kanji' ? home.interleave.card.char : home.interleave.card.groupKey;
    await learning.answerInterleave(kind, id, 'know');
    continue;
  }
  if (!home.card) break;
  let result = await learning.answerCard(home.card.id, 'know', { mode: 'mixed' });
  words += 1;
  if (result && result.interleave) {
    if (!rewindChecked) {
      const kind = result.interleave.kind;
      assert.equal((await learning.undoAnswer({ mode: 'mixed' })).undone, true);
      learning.rewindInterleave();
      result = await learning.answerCard(home.card.id, 'know', { mode: 'mixed' });
      assert.equal(result.interleave?.kind, kind, '撤掉触发插播的单词，再答应重现同一种卡');
      rewindChecked = true;
    }
    const underneath = await learning.getStudyHome({ mode: 'mixed' });
    assert.ok(underneath.card || underneath.stats.remaining === 0,
      '插播卡底下还有今日单词时，学习页必须留住下一张单词卡');
    const kind = result.interleave.kind;
    mixedSeen.add(kind);
    assert.equal(words % 5, 0, '插播只在答满 5 个单词之后出现');
    const id = kind === 'grammar' ? result.interleave.card.id : kind === 'kanji' ? result.interleave.card.char : result.interleave.card.groupKey;
    await learning.answerInterleave(kind, id, 'know');
  }
}
assert.ok(mixedSeen.size >= 2, `插播应该轮到至少两种卡，实际只有 ${[...mixedSeen].join(',')}`);
assert.ok(Number(db.exec('SELECT COUNT(*) FROM grammar_reviews')[0].values[0][0]) > 0, '语法插播写的是 grammar_reviews');
for (const [kind, table] of [['kanji', 'kanji_char_reviews'], ['confusion', 'confusion_reviews']]) {
  if (!mixedSeen.has(kind)) continue;
  assert.ok(Number(db.exec(`SELECT COUNT(*) FROM ${table}`)[0].values[0][0]) > 0, `${kind} 插播写的是 ${table}`);
}
// 撤销必须按刚答的那一种分派：撤语法不许动单词的流水
const wordReviews = Number(db.exec("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'")[0].values[0][0]);
const grammarReviews = Number(db.exec('SELECT COUNT(*) FROM grammar_reviews')[0].values[0][0]);
await learning.undoInterleave('grammar');
assert.equal(Number(db.exec("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'")[0].values[0][0]), wordReviews,
  '撤销语法插播不许碰单词流水（网页那边踩过：撤掉的是语法之前那个单词）');
assert.equal(Number(db.exec('SELECT COUNT(*) FROM grammar_reviews')[0].values[0][0]), grammarReviews - 1);
// 连线卡的四档由连错次数定，不让用户点四颗
assert.equal(learning.gradeMatching(0), 'know');
assert.equal(learning.gradeMatching(1), 'fuzzy');
assert.equal(learning.gradeMatching(3), 'forgot');

db.close();
console.log(JSON.stringify({ ok: true, modes, mixed: [...mixedSeen] }, null, 2));
