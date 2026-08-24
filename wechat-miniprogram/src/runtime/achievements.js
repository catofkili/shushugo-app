/* 成就不是静态图片：从本地 reviews / progress / 笔记 / 辨析状态现算，已有历史也会追认。 */
const core = require('../core/study-core');
function databaseStore() { return require('./database-store'); }

// 与 iOS 的 47 个成就保持稳定 id；metric 是小程序端可解释的本地统计字段。
const CATALOG = [
  ['first-know','开张','答对第一个词','🌱','起步',1,'totalKnow'],['first-note','好记性不如烂笔头','写下第一条便签','📝','起步',1,'notes'],['first-confusion','明察秋毫','掌握第一组辨析','🔍','起步',1,'confusionMastered'],['first-kanji','认字','开始汉字读音模式','🈶','起步',1,'kanjiWords'],['first-reverse','反过来','完成一次反向模式','🔄','起步',1,'reverseReviews'],
  ['words-100','百词斩','100 个词进入复习','💯','里程碑',100,'distinctWords'],['words-1000','千词斩','1,000 个词进入复习','🗡️','里程碑',1000,'distinctWords'],['words-3000','三千院','3,000 个词进入复习','⛩️','里程碑',3000,'distinctWords'],['reviews-10000','一万次','累计作答 10,000 次','🔢','里程碑',10000,'totalReviews'],['reviews-50000','五万次','累计作答 50,000 次','🏔️','里程碑',50000,'totalReviews'],['mastered-10','第一批毕业生','10 个词间隔达到半年','🎓','里程碑',10,'masteredWords'],['mastered-100','退休名单','100 个词间隔达到半年','🏝️','里程碑',100,'masteredWords'],['hours-100','一百小时','累计学习满 100 小时','⏳','里程碑',6000,'minutesTotal'],['one-year','一周年','从第一次学习起满一年','🎂','里程碑',365,'daysSinceFirst'],
  ['streak-7','一周不断','连续 7 天学习','📆','毅力',7,'longestDayStreak'],['streak-30','满月','连续 30 天学习','🌕','毅力',30,'longestDayStreak'],['streak-100','百日','连续 100 天学习','🎏','毅力',100,'longestDayStreak'],['comeback-7','归队','断一周后回来','🫡','毅力',7,'longestComebackGap'],['comeback-30','久别重逢','断一个月后回来','🕰️','毅力',30,'longestComebackGap'],['five-minutes','五分钟也是学','有一天只学不到五分钟','🕐','毅力',1,'shortStudyDay'],['day-1000','一日千词','单日作答 1,000 次','🔥','毅力',1000,'maxReviewsInDay'],['marathon','马拉松','单日学习满 8 小时','🏃','毅力',480,'maxMinutesInDay'],
  ['know-streak-25','顺风局','连着答对 25 次','📈','手感',25,'longestKnowStreak'],['know-streak-50','一气呵成','连着答对 50 次','⚡','手感',50,'longestKnowStreak'],['accuracy-90','稳如老狗','某天答满 100 次且正确率九成','🎯','手感',90,'bestDailyAccuracy'],['known-forever-20','断舍离','一天标记 20 次熟知','✂️','手感',20,'maxKnownForeverInDay'],
  ['forgot-streak-10','先冷静','连着点 10 次忘记','🧊','翻车',10,'longestForgotStreak'],['forgot-streak-20','再冷静一点','连着点 20 次忘记','🥶','翻车',20,'longestForgotStreak'],['leech-1','这词跟我有仇','有一个词忘了 8 次','😤','翻车',1,'leeches'],['leech-100','仇人名单','100 个词各忘了 8 次','📜','翻车',100,'leeches'],['relapse-forever','我明明背过','熟知后又忘记','🫠','翻车',1,'relapsedForever'],['fuzzy-half','假装在学','某天一半以上点模糊','😶‍🌫️','翻车',50,'worstDailyFuzzyShare'],['thrice-a-day','二进宫','同词同日忘记三次','🔁','翻车',1,'thriceForgotSameDay'],['backlog-500','鸵鸟','到期池积压 500 个','🙈','翻车',500,'dueBacklog'],['backlog-1000','债台高筑','到期池积压 1,000 个','🏦','翻车',1000,'dueBacklog'],
  ['ghosted','失联','断两周后回来','👻','翻车',14,'longestComebackGap'],['night-100','夜猫子','凌晨答过 100 次','🌙','怪癖',100,'nightReviews'],['night-1000','与月亮为伴','凌晨答过 1,000 次','🌚','怪癖',1000,'nightReviews'],['early-50','早起的鸟','清晨答过 50 次','🐦','怪癖',50,'earlyReviews'],['day-and-night','昼夜不分','同一天凌晨和早上都学习','🌗','怪癖',1,'dayAndNight'],['burst','手速','同一秒答掉 5 张卡','🖱️','怪癖',5,'sameSecondBurst'],['new-year','元旦也学','元旦学习过','🎍','怪癖',1,'studiedOnNewYear'],['leap-day','闰日','闰日学习过','🐸','怪癖',1,'studiedOnLeapDay'],
  ['notes-50','笔记狂魔','写下 50 条便签','🗂️','深挖',50,'notes'],['confusion-100','辨析大师','掌握 100 组辨析','🧠','深挖',100,'confusionMastered'],['favorites-50','收藏家','收藏 50 个词','⭐','深挖',50,'favorites'],['all-three','全家桶','单词、汉字、语法三条线都开过','🍱','深挖',3,'allThree']
].map(([id, name, description, emoji, category, goal, metric]) => ({ id, name, description, emoji, category, goal, metric }));

function safe(db, sql, params = [], fallback = 0) { try { return Number(core.firstValue(db, sql, params, fallback) ?? fallback); } catch { return fallback; } }
function longestAnswer(db, answer) {
  const rows = core.rowsFor(db, 'SELECT answer FROM reviews ORDER BY id'); let best = 0; let current = 0;
  rows.forEach((row) => { if (String(row.answer) === answer) { current += 1; best = Math.max(best, current); } else current = 0; }); return best;
}
function dayStats(db) {
  const days = core.rowsFor(db, 'SELECT DISTINCT reviewed_on AS day FROM reviews WHERE reviewed_on IS NOT NULL ORDER BY reviewed_on').map((row) => String(row.day));
  let streak = days.length ? 1 : 0; let current = streak; let gap = 0;
  for (let i = 1; i < days.length; i += 1) { const diff = Math.round((Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i - 1]}T00:00:00Z`)) / 86400000); if (diff === 1) { current += 1; streak = Math.max(streak, current); } else { gap = Math.max(gap, diff - 1); current = 1; } }
  return { streak, gap };
}
function stats(db) {
  const day = dayStats(db);
  const favorites = safe(db, "SELECT COUNT(*) FROM app_state WHERE key LIKE 'favorite:word:%' AND value = '1'");
  const maxReviews = safe(db, 'SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) n FROM reviews GROUP BY reviewed_on)');
  const longestKnowStreak = longestAnswer(db, 'know'); const longestForgotStreak = longestAnswer(db, 'forgot');
  const distinctWords = safe(db, 'SELECT COUNT(DISTINCT word_id) FROM reviews');
  const grammarPoints = safe(db, 'SELECT COUNT(*) FROM grammar_progress WHERE seen_count > 0');
  const kanjiWords = safe(db, 'SELECT COUNT(*) FROM kanji_reading_memory WHERE seen_count > 0');
  return {
    totalReviews: safe(db, 'SELECT COUNT(*) FROM reviews'), totalKnow: safe(db, "SELECT COUNT(*) FROM reviews WHERE answer IN ('know','known_forever')"),
    distinctWords, knownForeverTotal: safe(db, "SELECT COUNT(*) FROM reviews WHERE answer = 'known_forever'"),
    notes: safe(db, "SELECT COUNT(*) FROM word_notes WHERE TRIM(note) <> ''"), confusionMastered: safe(db, 'SELECT COUNT(*) FROM confusion_mastered'), favorites,
    reverseReviews: safe(db, "SELECT COUNT(*) FROM reviews WHERE direction = 'reverse'"), kanjiWords, grammarPoints,
    masteredWords: safe(db, `SELECT COUNT(*) FROM progress WHERE fsrs_due IS NOT NULL AND fsrs_last_review IS NOT NULL AND julianday(fsrs_due) - julianday(fsrs_last_review) >= 180`),
    leeches: safe(db, 'SELECT COUNT(*) FROM progress WHERE COALESCE(fsrs_lapses,0) >= 8'), dueBacklog: safe(db, 'SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count > 0 AND (fsrs_due IS NULL OR fsrs_due <= ?)', [core.studyDayEnd().toISOString()]),
    studyDays: safe(db, 'SELECT COUNT(DISTINCT reviewed_on) FROM reviews'), longestDayStreak: day.streak, longestComebackGap: day.gap,
    longestKnowStreak, longestForgotStreak, maxReviewsInDay: maxReviews, maxMinutesInDay: 0, minutesTotal: 0, daysSinceFirst: safe(db, "SELECT COALESCE(CAST(julianday('now') - julianday(MIN(reviewed_on)) AS INTEGER),0) FROM reviews"),
    maxKnownForeverInDay: safe(db, "SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) n FROM reviews WHERE answer='known_forever' GROUP BY reviewed_on)"),
    relapsedForever: safe(db, `SELECT COUNT(*) FROM (SELECT word_id FROM reviews WHERE answer='known_forever' INTERSECT SELECT word_id FROM reviews WHERE answer='forgot')`),
    thriceForgotSameDay: safe(db, "SELECT COUNT(*) FROM (SELECT word_id FROM reviews WHERE answer='forgot' GROUP BY word_id, reviewed_on HAVING COUNT(*) >= 3)"),
    nightReviews: 0, earlyReviews: 0, shortStudyDay: 0, bestDailyAccuracy: 0, worstDailyFuzzyShare: 0, dayAndNight: 0, sameSecondBurst: 0,
    allThree: (distinctWords > 0 ? 1 : 0) + (kanjiWords > 0 ? 1 : 0) + (grammarPoints > 0 ? 1 : 0)
  };
}

function ensureAchievementsSchema(db) { db.run('CREATE TABLE IF NOT EXISTS achievement_unlocked (id TEXT PRIMARY KEY, unlocked_on TEXT NOT NULL)'); }
function boardWithDb(db) {
  ensureAchievementsSchema(db);
  const current = stats(db);
  const unlocked = new Set(core.rowsFor(db, 'SELECT id FROM achievement_unlocked').map((row) => String(row.id)));
  const today = core.localStudyDay(new Date());
  CATALOG.forEach((item) => { if (!unlocked.has(item.id) && Number(current[item.metric] || 0) >= item.goal) { db.run('INSERT OR IGNORE INTO achievement_unlocked (id, unlocked_on) VALUES (?, ?)', [item.id, today]); unlocked.add(item.id); } });
  return { items: CATALOG.map((item) => ({ ...item, progress: Math.min(item.goal, Math.floor(Number(current[item.metric] || 0))), unlocked: unlocked.has(item.id) })), unlocked: unlocked.size, total: CATALOG.length };
}
function achievementBoard() { const db = databaseStore().getDatabase(); return boardWithDb(db); }

module.exports = { CATALOG, ensureAchievementsSchema, stats, boardWithDb, achievementBoard };
