/*
 * 共享功能层（收藏 / 备考 / 周报 / 柚子 / 词汇量）的回归。
 * 判据本身在 frontend 的测试里；这里盯的是「小程序接上去之后行为还是网页那份」：
 * 表建对了、id 换算对了、墓碑补了、测验不碰学习进度、账本幂等、周报 content_json 是网页的形状。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const seed = () => new SQL.Database(new Uint8Array(fs.readFileSync(path.resolve(root, '../frontend/public/nihongo.db'))));
const db = seed();
const core = require('../src/core/study-core.js');
core.ensureStudySchema(db);

globalThis.wx = { env: { USER_DATA_PATH: '/tmp/shushugo-feature-smoke' }, getFileSystemManager: () => ({}) };
const store = require('../src/runtime/database-store.js');
store.getDatabase = () => db;
let saves = 0;
store.saveDatabase = async () => { saves += 1; return { bytes: 0 }; };
const features = require('../src/runtime/extended-features.js');
const words = require('../src/runtime/word-library.js');
const grammar = require('../src/runtime/grammar.js');
const { exportSyncSnapshot, mergeSnapshot } = require('../src/runtime/sync-snapshot.js');
const { web } = features;

for (const table of ['content_favorites', 'favorite_folders', 'vocab_test_history', 'yuzu_ledger', 'weekly_reports', 'achievements']) {
  assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", [table], 0), 1, `${table} must exist`);
}

/* ---- 收藏：word 存数字 id、grammar 存网页的字符串 id；删了补墓碑，加回撤墓碑 ---- */
const wordId = Number(core.firstValue(db, 'SELECT id FROM words ORDER BY id LIMIT 1'));
assert.equal(await words.toggleWordFavorite(wordId), true);
assert.equal(await grammar.toggleGrammarFavorite(17), true);
assert.deepEqual(
  core.rowsFor(db, 'SELECT item_type, item_id FROM content_favorites ORDER BY item_type').map((row) => [row.item_type, row.item_id]),
  [['grammar', 'pdf-n5-017'], ['word', String(wordId)]],
  '语法收藏必须是 grammar.ts 的字符串 id，和网页同一批行'
);
assert.equal(features.listFavorites().length, 2);
assert.equal(features.listFavorites('grammar')[0].title !== '', true, '语法收藏要用本地 grammar_points 补出标题');
assert.equal(await features.createFavoriteFolder('  考试   重点  '), '考试 重点', '夹名清洗同网页：合并空白、截 20 字');
await features.moveFavorite('word', String(wordId), '考试 重点');
assert.equal(features.listFavorites('word', '考试 重点').length, 1);
assert.deepEqual(features.listFavoriteFolders(), [{ name: '考试 重点', count: 1 }]);
assert.equal(await features.renameFavoriteFolder('考试 重点', '冲刺'), '冲刺');
assert.equal(features.listFavorites('word', '冲刺').length, 1, '改名要连带把收藏行的 folder 一起改');
await features.deleteFavoriteFolder('冲刺');
assert.equal(features.unfiledFavoriteCount(), 2, '删夹子不删收藏，里面的东西回到未分类');
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM sync_tombstones WHERE entity = 'favorite_folders' AND natural_key = '冲刺'"), 1, '删夹子要留墓碑，否则对端把它复活');
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM sync_tombstones WHERE entity = 'favorite_folders' AND natural_key = '考试 重点'"), 1, '改名 = 旧名删除');
assert.ok(core.rowsFor(db, 'SELECT sync_updated_at FROM content_favorites').every((row) => row.sync_updated_at), '小程序没有触发器，每次写都要自己盖 sync_updated_at，否则 lww 合并时输给对端的旧行');
assert.equal(await grammar.toggleGrammarFavorite(17), false);
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM sync_tombstones WHERE entity = 'content_favorites' AND natural_key = ?", ['grammar\u001fpdf-n5-017'], 0), 1, '小程序没有触发器，删收藏要自己补墓碑');
assert.equal(await grammar.toggleGrammarFavorite(17), true);
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM sync_tombstones WHERE entity = 'content_favorites'", [], 0), 0, '加回来要撤掉墓碑');
assert.ok(grammar.grammarRows(db, '', 'N5', 50).find((row) => Number(row.id) === 17).favorite === 1, '列表按字符串 id 亮星');

/* ---- 备考：偏好在 wx 存储（键名同网页），状态形状是网页的 ---- */
features.saveJlptPreferences({ jlptTarget: 'N3', jlptExamDate: '' });
const status = features.jlptPlanStatus(new Date('2026-09-22T10:00:00+08:00'));
assert.equal(status.target, 'N3');
assert.equal(status.examDateSource, 'auto');
assert.ok(status.plan.daysLeft > 0 && 'newWordsDone' in status.done && 'clear' in status.shortfall);
assert.equal(JSON.parse(globalThis.localStorage.getItem('mn-study-preferences')).jlptTarget, 'N3', 'studyPreferences 落在 localStorage 替身（wx 存储）里');

/* ---- 词汇量：网页算法（摸底 20 → 补到 60、四选一 + 不认识、猜测修正），一个字都不碰学习进度 ---- */
const beforeProgress = Number(core.firstValue(db, 'SELECT SUM(seen_count) FROM progress', [], 0));
const beforeReviews = Number(core.firstValue(db, 'SELECT COUNT(*) FROM reviews', [], 0));
let session = features.vocabTest.start();
assert.equal(session.questions.length, 20, '先只出摸底 20 道');
assert.equal(session.plannedTotal, 60);
assert.ok(session.questions.every((question) => question.options.length === 4));
while (session && !session.finishedAt && session.currentIndex < session.questions.length) {
  const question = session.questions[session.currentIndex];
  // 前 30 题全对，之后一半不认识一半答错：可信度要能把「蒙」折算出来
  const index = session.currentIndex;
  const state = index < 30 ? 'correct' : index % 2 ? 'unknown' : 'wrong';
  session = features.vocabTest.submit(state, state === 'correct' ? question.answerIndex : state === 'wrong' ? (question.answerIndex + 1) % 4 : null, 3000);
}
assert.ok(session.questions.length > 20, '摸底答完要按实测水平补题');
session = await features.vocabTest.finish();
const result = features.vocabTest.result(session);
assert.ok(result.estimated > 0 && result.lower <= result.estimated && result.estimated <= result.upper);
assert.ok(result.guessedShare > 0 && result.confidence < 100, '答错的要按 (4/3)·W/n 折进可信度，不是正确率');
assert.equal(Number(core.firstValue(db, 'SELECT COUNT(*) FROM vocab_test_history', [], 0)), 1);
await features.vocabTest.finish();
assert.equal(Number(core.firstValue(db, 'SELECT COUNT(*) FROM vocab_test_history', [], 0)), 1, '按 run_id 幂等');
assert.equal(Number(core.firstValue(db, 'SELECT SUM(seen_count) FROM progress', [], 0)), beforeProgress, '词汇量测试不得写学习进度');
assert.equal(Number(core.firstValue(db, 'SELECT COUNT(*) FROM reviews', [], 0)), beforeReviews, '词汇量测试不得写作答流水');
assert.equal(features.vocabTest.history()[0].levels.length, 5);

/* ---- 柚子：只奖「做完了」，账本幂等；目录是网页的那 13 件 ---- */
db.run("INSERT OR IGNORE INTO achievements(id, unlocked_on) VALUES('feature-smoke', '2026-09-22')");
assert.equal(await features.settleYuzu(), 20);
assert.equal(await features.settleYuzu(), 0, '柚子结算必须幂等');
db.run("INSERT OR IGNORE INTO yuzu_ledger(kind, key, amount, day) VALUES('test', 'seed', 500, '2026-09-22')");
assert.equal(features.yuzuShop().items.length, web.yuzuCatalog.YUZU_ITEMS.length);
assert.equal(await features.buyYuzuItem('theme-matcha'), true);
assert.equal(features.equippedYuzu('theme'), 'theme-matcha', '买了槽位空着就自动装上');
assert.equal(await features.buyYuzuItem('icon-happy'), false, 'soon 的商品不卖');
assert.equal(await features.buyYuzuItem('voice-voicevox-10'), false, '余额 320 买不起 600 的');
assert.equal(features.yuzuBalance(), 320);

/* ---- 周报：content_json 必须是网页 analytics/weekly 的形状（window.endAt、metrics.days、keyword…） ---- */
const now = new Date('2026-09-22T10:00:00+08:00');
core.recordAnswer(db, wordId, 'know', { now: new Date('2026-09-15T10:00:00+08:00') });
core.recordAnswer(db, wordId, 'forgot', { now: new Date('2026-09-16T10:00:00+08:00') });
const report = features.weeklyReport(0, now);
assert.equal(report.window.start, '2026-09-13');
assert.ok(Number.isFinite(report.window.endAt) && report.metrics.daily.length === 7 && 'keyword' in report && Array.isArray(report.revisitWords));
const stored = JSON.parse(core.firstValue(db, "SELECT content_json FROM weekly_reports WHERE week_start = '2026-09-13'"));
assert.equal(stored.metrics.totalReviews, 2);
assert.equal(core.firstValue(db, "SELECT schema_version FROM weekly_reports WHERE week_start = '2026-09-13'"), 3);
assert.ok(features.listWeeklyReports()[0].readAt == null);
assert.equal(await features.markWeeklyReportRead('2026-09-13'), true);

/* ---- 同步：免费账号的周报不上云；收藏 / 账本 / 测验历史 / 成就 真实往返 ---- */
const freeSnapshot = new SQL.Database(await exportSyncSnapshot(db, { includeWeeklyReports: false }));
assert.equal(core.firstValue(freeSnapshot, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'weekly_reports'"), 0, '免费账号本机留周报，但不推上云端（同网页 syncedTablesForCloud）');
freeSnapshot.close();
const proSnapshot = await exportSyncSnapshot(db, { includeWeeklyReports: true });
const other = seed();
core.ensureStudySchema(other);
mergeSnapshot(other, proSnapshot);
for (const [table, sql] of [
  ['content_favorites', "SELECT COUNT(*) FROM content_favorites"],
  ['yuzu_ledger', "SELECT COALESCE(SUM(amount), 0) FROM yuzu_ledger"],
  ['vocab_test_history', "SELECT COUNT(*) FROM vocab_test_history"],
  ['achievements', "SELECT COUNT(*) FROM achievements"],
  ['weekly_reports', "SELECT COUNT(*) FROM weekly_reports"]
]) {
  assert.equal(core.firstValue(other, sql), core.firstValue(db, sql), `${table} 必须原样到对端`);
}
const roundTrip = new SQL.Database(await exportSyncSnapshot(other, { includeWeeklyReports: true }));
assert.equal(core.firstValue(roundTrip, "SELECT COUNT(*) FROM content_favorites"), 2, '对端再导出仍然带着这些行');
roundTrip.close(); other.close();

// 本机已经删除的收藏不能被另一台设备的旧快照复活；较新的本机分组移动也不能被旧 folder 覆盖。
const remote = seed();
const local = seed();
for (const database of [remote, local]) core.ensureStudySchema(database);
remote.run("INSERT INTO content_favorites(item_type,item_id,folder,created_at,sync_updated_at) VALUES('word','1','旧分组','2026-01-01','2026-01-01T00:00:00.000Z')");
const remoteSnapshot = await exportSyncSnapshot(remote, { includeWeeklyReports: false });
local.run("INSERT OR REPLACE INTO sync_tombstones(entity,natural_key,deleted_at) VALUES('content_favorites',?,?)", ['word\u001f1', '2026-02-01T00:00:00.000Z']);
mergeSnapshot(local, remoteSnapshot);
assert.equal(core.firstValue(local, "SELECT COUNT(*) FROM content_favorites WHERE item_type='word' AND item_id='1'", [], 0), 0, '旧快照不能复活已删除收藏');
local.run("DELETE FROM sync_tombstones WHERE entity='content_favorites' AND natural_key=?", ['word\u001f1']);
local.run("INSERT INTO content_favorites(item_type,item_id,folder,created_at,sync_updated_at) VALUES('word','1','新分组','2026-01-01','2026-03-01T00:00:00.000Z')");
mergeSnapshot(local, remoteSnapshot);
assert.equal(core.firstValue(local, "SELECT folder FROM content_favorites WHERE item_type='word' AND item_id='1'"), '新分组', '旧快照不能覆盖较新的收藏分组');
remote.close(); local.close();

/* ---- 分包里的静态内容 ---- */
const foundation = require('../src/features/data/grammar-foundation.js');
const kanji = require('../src/features/data/kanji-reading-usage.js');
assert.equal(foundation.grammarFoundationRules.length, 43);
await kanji.loadKanjiReadingUsage();
assert.equal(kanji.allKanjiReadingUsage().length, 520);
assert.ok(kanji.kanjiReadingUsageFor('日').readings.length >= 2);

assert.ok(saves > 0, '写操作要落盘');
db.close();
console.log(JSON.stringify({ ok: true, questions: session.questions.length, estimated: result.estimated, confidence: result.confidence, foundation: 43, kanji: 520 }, null, 2));
