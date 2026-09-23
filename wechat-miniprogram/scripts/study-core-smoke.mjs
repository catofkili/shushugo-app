/*
 * 学习核心的回归。**判据本身在 frontend 的测试里**（调度器、FSRS、撤销都是网页那份源码）；
 * 这里盯的是「小程序接上去之后还是那一份」：建表 + 触发器、三个方向各写对表、
 * 撤销留墓碑、汉字读音卡不泄题、内容更新不冲掉进度。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const seedPath = path.resolve(root, '../frontend/public/nihongo.db');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(seedPath)));

const storage = {};
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/shushugo-study-core-smoke' },
  getFileSystemManager: () => ({}),
  getStorageSync: (key) => storage[key] ?? '',
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; }
};
const store = require('../src/runtime/database-store.js');
store.getDatabase = () => db;
store.saveDatabase = async () => ({ bytes: 0 });
await store.ensureContentLoaded();

const core = require('../src/core/study-core.js');
const { mergeContentDatabase } = require('../src/runtime/content-update.js');
const { studySummary } = require('../src/core/analytics.js');
const learning = require('../src/runtime/learning.js');
const { web } = core;

// 学习日边界是凌晨四点，和网页同一条。
assert.equal(core.localStudyDay(new Date('2026-08-22T03:59:00+08:00')), '2026-08-21');
assert.equal(core.localStudyDay(new Date('2026-08-22T04:00:00+08:00')), '2026-08-22');

core.ensureStudySchema(db);
assert.equal(core.firstValue(db, 'SELECT COUNT(*) FROM progress'), 10919, '首次打开应创建所有 progress 行');
// ⚠️ 同步触发器必须建出来：小程序以前没有触发器，删除不留墓碑，对端合并时原样复活。
assert.ok(core.firstValue(db, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%_sync_%'", [], 0) > 0,
  '网页的同步触发器必须装在小程序的库上');
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM pragma_table_info('sync_tombstones') WHERE name = 'table_name'"), 1,
  '墓碑表必须是网页的列名（table_name / row_key）');

// 今日计划 → 出卡 → 作答 → 撤销
const plan = core.createTodayPlan(db);
assert.ok(plan.planned > 0, '应排出今日计划');
const home = await learning.getStudyHome({ direction: 'forward' });
assert.ok(home.card && home.card.id, '计划必须能取出第一张卡');
assert.equal(home.stats.planned, plan.planned);
// 正向题面是中文题面层（人工审校那一层），答案面才是日文词形 —— 和网页一致。
assert.ok(home.card.prompt && !/[぀-ヿ]/.test(home.card.prompt.replace(/[（）()]/g, '')) || home.card.prompt !== home.card.surface,
  '正向卡的题面不能就是日文词形');
await learning.answerCard(home.card.id, 'know', { direction: 'forward' });
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'forward'"), 1);
assert.equal(core.firstValue(db, "SELECT event_source FROM reviews WHERE direction = 'forward'"), 'study');
assert.ok(core.firstValue(db, "SELECT sync_uid FROM reviews WHERE direction = 'forward'"), '作答必须带跨端身份 sync_uid');

await learning.saveWordNote(home.card.id, 'smoke note');
assert.equal(core.firstValue(db, 'SELECT note FROM word_notes WHERE word_id = ?', [home.card.id]), 'smoke note');

const undoUid = core.firstValue(db, "SELECT sync_uid FROM reviews WHERE direction = 'forward'");
const undone = await learning.undoAnswer({ direction: 'forward' });
assert.equal(undone.undone, true, '最后一张卡应可安全撤销');
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'forward'"), 0);
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM sync_tombstones WHERE table_name = 'reviews' AND row_key = ?", [undoUid], 0), 1,
  '撤销必须留墓碑，否则这条作答会在对端下一次合并时复活');

// 反向 / 汉字读音的当日计划只从「学过的词」里排，所以先答几张正向。
// ⚠️ 要答到计划里不止一条：一条的话答完当天这个方向就 done 了，
// 而 done 之后网页本来就不给撤销（canUndo 为假），那时候断言撤销等于测了个假规则。
for (let index = 0; index < 4; index += 1) {
  const seeded = await learning.getStudyHome({ direction: 'forward' });
  if (!seeded.card) break;
  await learning.answerCard(seeded.card.id, 'know', { direction: 'forward' });
}
const reverse = await learning.getStudyHome({ direction: 'reverse' });
assert.ok(reverse.card, '已有正向学习记录后应能出反向卡');
assert.ok(core.firstValue(db, "SELECT COUNT(*) FROM stage2_progress WHERE reviewed_on = ?", [core.localStudyDay()], 0) > 0,
  '反向的当日计划写在网页的 stage2_progress 表里');
await learning.answerCard(reverse.card.id, 'know', { direction: 'reverse' });
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'reverse'"), 1);
assert.equal(core.firstValue(db, 'SELECT seen_count FROM reverse_memory WHERE word_id = ?', [reverse.card.id]), 1);
const reverseNext = await learning.getStudyHome({ direction: 'reverse' });
if (reverseNext.canUndo) {
  assert.equal((await learning.undoAnswer({ direction: 'reverse' })).undone, true);
  assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'reverse'"), 0);
}

// 汉字读音：题面是表记，只遮汉字那几拍；流水记 kanji_reading（写成 kanji 会被当成归档的旧题型）
const kanji = await learning.getStudyHome({ direction: 'kanji' });
assert.ok(kanji.card, '汉字读音方向应能取到卡');
assert.ok(/[㐀-鿿]/.test(kanji.card.surface), '题面里必须真的有汉字');
assert.ok(Array.isArray(kanji.card.concealedReading) && kanji.card.concealedReading.some((part) => part.hidden),
  '揭晓前至少要遮住一段读音');
assert.ok(kanji.card.concealedReading.every((part) => part.hidden || !/[㐀-鿿]/.test(part.text)),
  '露出来的只能是送り仮名/片假名');
await learning.answerCard(kanji.card.id, 'know', { direction: 'kanji' });
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'kanji_reading'"), 1);
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'kanji'"), 0);
assert.equal(core.firstValue(db, 'SELECT seen_count FROM kanji_reading_memory WHERE word_id = ?', [kanji.card.id]), 1);
const kanjiNext = await learning.getStudyHome({ direction: 'kanji' });
if (kanjiNext.canUndo) {
  assert.equal((await learning.undoAnswer({ direction: 'kanji' })).undone, true, '汉字读音卡也要能撤销');
}

// 现代日语里本来就写假名的词不该被当成汉字读音卡问一遍（判据是网页的 orthography）
const kanaOnly = core.rowsFor(db, `
  SELECT t.word_id, w.kanji, w.kana FROM kanji_reading_progress t JOIN words w ON w.id = t.word_id
  WHERE t.reviewed_on = ?
`, [core.localStudyDay()]).filter((row) => !web.orthography.shouldStudyKanjiReading(row));
assert.equal(kanaOnly.length, 0, `汉字读音计划里混进了不该出汉字卡的词: ${kanaOnly.map((row) => `${row.kanji}/${row.kana}`).join(', ')}`);

// 内容更新只替换 words，不得冲掉用户进度和复习流水
const source = new SQL.Database(new Uint8Array(fs.readFileSync(seedPath)));
core.ensureTablesOnly(source);
source.run('UPDATE words SET meaning = ? WHERE id = ?', ['内容更新后的释义', home.card.id]);
const second = await learning.getStudyHome({ direction: 'forward' });
await learning.answerCard(second.card.id, 'know', { direction: 'forward' });
const beforeReviews = core.firstValue(db, 'SELECT COUNT(*) FROM reviews');
const merge = mergeContentDatabase(db, source, 'content-v2');
assert.equal(merge.sourceWords, 10919);
assert.equal(core.firstValue(db, 'SELECT COUNT(*) FROM reviews'), beforeReviews);
assert.equal(core.firstValue(db, 'SELECT seen_count FROM progress WHERE word_id = ?', [second.card.id]), 1);
assert.equal(core.firstValue(db, 'SELECT meaning FROM words WHERE id = ?', [home.card.id]), '内容更新后的释义');
source.close();

const summary = studySummary(db);
assert.ok(summary.levels.length >= 5 && summary.recentDays.length === 28, '足迹页要 28 格 + 各等级进度');
const today = core.localStudyDay();
db.run('INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)', [today]);
assert.equal(studySummary(db).streak, 1, '连击按连续日期算');

db.close();
console.log(JSON.stringify({ ok: true, planned: plan.planned, reviews: beforeReviews }, null, 2));
