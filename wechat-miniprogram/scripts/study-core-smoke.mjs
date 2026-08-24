import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from '../../frontend/node_modules/sql.js/dist/sql-wasm.js';
import core from '../src/core/study-core.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mergeContentDatabase } = require('../src/runtime/content-update.js');
const { studySummary } = require('../src/core/analytics.js');
const { shouldStudyKanjiReading } = require('../src/core/orthography.js');

const root = path.resolve(import.meta.dirname, '..');
const seedPath = path.resolve(root, '../frontend/public/nihongo.db');
const SQL = await initSqlJs({ locateFile: (name) => path.resolve(root, '../frontend/node_modules/sql.js/dist', name) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(seedPath)));
const now = new Date('2026-08-22T12:00:00+08:00');

assert.equal(core.localStudyDay(new Date('2026-08-22T03:59:00+08:00')), '2026-08-21');
assert.equal(core.localStudyDay(new Date('2026-08-22T04:00:00+08:00')), '2026-08-22');

core.ensureStudySchema(db);
assert.equal(core.firstValue(db, 'SELECT COUNT(*) FROM progress'), 10919, '首次打开应创建所有 progress 行');

const plan = core.createTodayPlan(db, { now, reviewLimit: 4, newLimit: 3 });
assert.equal(plan.count, 3, '无历史记录时应生成新词计划');
const first = core.nextCard(db, { now });
assert.ok(first?.id, '计划必须能取出第一张卡');
const answer = core.recordAnswer(db, first.id, 'know', { now });
assert.equal(answer.stats.answered, 1);
assert.ok(answer.fsrs?.due, '作答后必须写入 FSRS due');
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'forward'"), 1);

core.saveNote(db, first.id, 'smoke note', now);
assert.equal(core.firstValue(db, 'SELECT note FROM word_notes WHERE word_id = ?', [first.id]), 'smoke note');

const undone = core.undoLastAnswer(db, { now });
assert.equal(undone.undone, true, '最后一张卡应可安全撤销');
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'forward'"), 0);
assert.equal(core.firstValue(db, 'SELECT seen_count FROM progress WHERE word_id = ?', [first.id]), 0);

const seededForward = core.nextCard(db, { now });
core.recordAnswer(db, seededForward.id, 'know', { now });
const reversePlan = core.createDirectionPlan(db, 'reverse', { now, directionLimit: 1 });
assert.equal(reversePlan.count, 1, '已有正向学习记录后应能生成反向计划');
const reverseCard = core.nextCard(db, { now, direction: 'reverse' });
assert.ok(reverseCard?.prompt && reverseCard.direction === 'reverse');
core.recordAnswer(db, reverseCard.id, 'know', { now, direction: 'reverse' });
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'reverse'"), 1);
assert.equal(core.firstValue(db, 'SELECT seen_count FROM reverse_memory WHERE word_id = ?', [reverseCard.id]), 1);
assert.equal(core.undoLastAnswer(db, { now }).undone, true);
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'reverse'"), 0);

// 汉字读音方向：题面是表记，答案是读音；流水必须写 kanji_reading（和 iOS 对齐）。
const kanjiPlan = core.createDirectionPlan(db, 'kanji', { now, directionLimit: 3 });
assert.ok(kanjiPlan.count > 0, '有正向学习记录后应能生成汉字读音计划');
const kanjiCard = core.nextCard(db, { now, direction: 'kanji' });
assert.ok(kanjiCard, '汉字读音方向应能取到卡');
assert.ok(kanjiCard.surface && kanjiCard.surface !== kanjiCard.kana,
  '汉字读音卡的题面必须是表记，且不能和读音是同一串');
assert.ok(/[\u3400-\u9fff]/.test(kanjiCard.surface), '题面里必须真的有汉字');
assert.ok(Array.isArray(kanjiCard.concealedReading) && kanjiCard.concealedReading.some((part) => part.hidden),
  '揭晓前至少要遮住一段读音');
assert.ok(kanjiCard.concealedReading.every((part) => !part.hidden ? !/[\u3400-\u9fff]/.test(part.text) : true),
  '露出来的只能是送り仮名/片假名，不能把汉字读音漏出去');
core.recordAnswer(db, kanjiCard.id, 'know', { now, direction: 'kanji' });
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'kanji_reading'"), 1,
  '汉字方向的流水必须记成 kanji_reading —— 写成 kanji 的话 iOS 会当成归档的旧题型');
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'kanji'"), 0);
assert.equal(core.firstValue(db, 'SELECT seen_count FROM kanji_reading_memory WHERE word_id = ?', [kanjiCard.id]), 1);
assert.equal(core.undoLastAnswer(db, { now }).undone, true, '汉字读音卡也要能撤销');
assert.equal(core.firstValue(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'kanji_reading'"), 0);

// 现代日语里本来就写假名的词，不该被当成汉字读音卡问一遍。
const kanaOnly = core.rowsFor(db, `
  SELECT t.word_id, w.kanji, w.kana FROM direction_tasks t JOIN words w ON w.id = t.word_id
  WHERE t.direction = 'kanji'
`).filter((row) => !shouldStudyKanjiReading(row));
assert.equal(kanaOnly.length, 0,
  `汉字读音计划里混进了不该出汉字卡的词: ${kanaOnly.map((r) => `${r.kanji}/${r.kana}`).join(', ')}`);

// 内容更新只替换 words，不得冲掉用户进度和复习流水。
const source = new SQL.Database(new Uint8Array(fs.readFileSync(seedPath)));
core.ensureStudySchema(source);
source.run('UPDATE words SET meaning = ? WHERE id = ?', ['内容更新后的释义', first.id]);
const second = core.nextCard(db, { now });
core.recordAnswer(db, second.id, 'know', { now });
const beforeReviews = core.firstValue(db, 'SELECT COUNT(*) FROM reviews');
const merge = mergeContentDatabase(db, source, 'content-v2');
assert.equal(merge.sourceWords, 10919);
assert.equal(core.firstValue(db, 'SELECT COUNT(*) FROM reviews'), beforeReviews);
assert.equal(core.firstValue(db, 'SELECT seen_count FROM progress WHERE word_id = ?', [second.id]), 1);
assert.equal(core.firstValue(db, 'SELECT meaning FROM words WHERE id = ?', [first.id]), '内容更新后的释义');
const summary = studySummary(db, now);
assert.ok(summary.levels.length >= 5 && summary.today > 0, '统计页应能读取本地作答和 JLPT 分组');
db.run("INSERT OR IGNORE INTO checkins (checked_on) VALUES ('2026-08-21'), ('2026-08-20')");
assert.equal(studySummary(db, now).streak, 3, '统计页的连续学习天数应按连续日期而不是七日总数计算');
source.close();

db.close();
console.log(JSON.stringify({ ok: true, plan, firstCard: first.id, undo: undone }, null, 2));
