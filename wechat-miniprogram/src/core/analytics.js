const core = require('./study-core');

function studySummary(db, now = new Date()) {
  core.ensureStudySchema(db);
  const day = core.localStudyDay(now);
  const weekStart = new Date(`${day}T12:00:00`);
  weekStart.setDate(weekStart.getDate() - 6);
  const start = core.localStudyDay(weekStart);
  const today = core.firstValue(db, `SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?`, [day], 0);
  const week = core.firstValue(db, `SELECT COUNT(*) FROM reviews WHERE reviewed_on >= ?`, [start], 0);
  const correct = core.firstValue(db, `SELECT COUNT(*) FROM reviews WHERE reviewed_on >= ? AND answer IN ('know', 'known_forever')`, [start], 0);
  const due = core.firstValue(db, `SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count > 0 AND (fsrs_due IS NULL OR fsrs_due <= ?)`, [core.studyDayEnd(now).toISOString()], 0);
  const levels = core.rowsFor(db, `
    SELECT COALESCE(w.jlpt_level, '未分级') AS level,
           COUNT(*) AS total,
           SUM(CASE WHEN p.seen_count > 0 THEN 1 ELSE 0 END) AS seen,
           SUM(CASE WHEN p.known_forever = 1 THEN 1 ELSE 0 END) AS mastered
    FROM words w JOIN progress p ON p.word_id = w.id
    GROUP BY COALESCE(w.jlpt_level, '未分级')
    ORDER BY CASE level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 6 END
  `).map((row) => ({ ...row, seenPercent: Number(row.total) ? Number(((Number(row.seen) / Number(row.total)) * 100).toFixed(1)) : 0 }));
  const checkins = new Set(core.rowsFor(db, 'SELECT checked_on FROM checkins').map((row) => String(row.checked_on)));
  const localDateKey = (value) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const date = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
  };
  let streak = 0;
  const cursor = new Date(`${day}T12:00:00`);
  while (checkins.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const recentDays = [];
  const heatCursor = new Date(`${day}T12:00:00`);
  heatCursor.setDate(heatCursor.getDate() - 27);
  for (let index = 0; index < 28; index += 1) {
    const key = localDateKey(heatCursor);
    recentDays.push({ day: key, count: Number(core.firstValue(db, 'SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?', [key], 0)) });
    heatCursor.setDate(heatCursor.getDate() + 1);
  }
  return {
    day,
    today: Number(today),
    week: Number(week),
    accuracy: Number(week) ? Number(((Number(correct) / Number(week)) * 100).toFixed(1)) : null,
    due: Number(due),
    streak,
    recentDays,
    levels
  };
}

module.exports = { studySummary };
