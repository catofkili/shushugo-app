/*
 * 首页 / 足迹页的汇总。**数字全部来自网页的 word-api + progress-api**：
 * 日历那格用 stats.dailyStudyStats（减负 + 单词 + 语法同一口径，2026-09-19 用户定的），
 * 等级进度用 getProgressOverview，连击用网页的 computeStreak。
 * 以前这里自己写了一套 SQL，于是同一天的数在小程序和网页上对不上。
 */
const core = require('./study-core');

const web = core.web;

function studySummary(db, now = new Date()) {
  core.ensureStudySchema(db);
  return core.withDb(db, () => {
    const stats = web.wordApi.getWordStats('stage1');
    const overview = web.progressApi.getProgressOverview();
    const day = web.dbUtils.studyDate(now);
    // dailyStudyStats 是稀疏的（只有有记录的那几天）；热力图要连续的 28 格，这里补零。
    const byDay = new Map((stats.dailyStudyStats || []).map((item) => [item.date, item.total]));
    const recentDays = [];
    const cursor = new Date(`${day}T12:00:00`);
    cursor.setDate(cursor.getDate() - 27);
    for (let index = 0; index < 28; index += 1) {
      const key = web.dbUtils.studyDate(cursor);
      recentDays.push({ day: key, count: byDay.get(key) || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    const week = recentDays.slice(-7).reduce((sum, item) => sum + item.count, 0);
    const streak = web.streak.computeStreak(stats.checkins || [], day);
    // 近 7 天答对率（只用于展示：不参与任何调度，也不写任何表）。
    // 「答对」的定义和网页一致：know / known_forever。
    const since = recentDays[recentDays.length - 7].day;
    const answered = web.dbUtils.firstValue('SELECT COUNT(*) FROM reviews WHERE reviewed_on >= ?', [since], 0);
    const correct = web.dbUtils.firstValue("SELECT COUNT(*) FROM reviews WHERE reviewed_on >= ? AND answer IN ('know', 'known_forever')", [since], 0);
    return {
      day,
      today: byDay.get(day) || 0,
      week,
      accuracy: answered ? Number(((correct / answered) * 100).toFixed(1)) : null,
      due: stats.lowCount,
      streak,
      // 28 天足迹：和网页完成页日历同一口径（单词 + 语法 + 减负）
      recentDays,
      levels: overview.wordsByLevel.map((level) => ({
        level: level.level,
        total: level.total,
        seen: level.seen,
        mastered: level.completed,
        seenPercent: level.total ? Number(((level.seen / level.total) * 100).toFixed(1)) : 0
      }))
    };
  });
}

module.exports = { studySummary };
