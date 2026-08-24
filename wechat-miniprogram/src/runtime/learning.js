const { getDatabase, saveDatabase } = require('./database-store');
const core = require('../core/study-core');
const dailyRelief = require('./daily-relief');

function withDatabase(task) {
  const db = getDatabase();
  core.ensureStudySchema(db);
  return task(db);
}

async function getStudyHome(options = {}) {
  return withDatabase((db) => {
    const direction = options.direction || 'forward';
    const mode = options.mode && ['quick', 'mistakes'].includes(options.mode) ? options.mode : '';
    const plan = mode
      ? core.createModePlan(db, mode, options)
      : direction === 'forward'
        ? core.createTodayPlan(db, options)
        : core.createDirectionPlan(db, direction, options);
    const stats = mode ? core.getModeStats(db, mode, options.now) : core.getTodayStats(db, options.now, direction);
    const relief = !mode && direction === 'forward' ? dailyRelief.nextDailyRelief(db, options.now) : null;
    const card = relief || core.nextCard(db, options);
    const reliefState = !mode && direction === 'forward' ? dailyRelief.ensureDailyRelief(db, options.now) : null;
    return { plan, stats: reliefState ? { ...stats, reliefTotal: reliefState.wordIds.length, reliefCompleted: reliefState.completed } : stats, card, mode };
  });
}

async function answerCard(wordId, answer, options = {}) {
  return withDatabase(async (db) => {
    if (options.relief) {
      const state = dailyRelief.advanceDailyRelief(db, options.now);
      await saveDatabase();
      return { relief: true, state, card: core.cardById(db, wordId) };
    }
    const result = core.recordAnswer(db, wordId, answer, options);
    await saveDatabase();
    return result;
  });
}

async function undoAnswer(options = {}) {
  return withDatabase(async (db) => {
    const result = core.undoLastAnswer(db, options);
    if (result.undone) await saveDatabase();
    return result;
  });
}

async function saveWordNote(wordId, note) {
  return withDatabase(async (db) => {
    core.saveNote(db, wordId, note);
    await saveDatabase();
    return { wordId, note: String(note ?? '') };
  });
}

function searchWords(query, options = {}) {
  return withDatabase((db) => {
    const text = String(query ?? '').trim();
    if (!text) return [];
    const like = `%${text}%`;
    const params = [like, like, like];
    let levelClause = '';
    if (options.level && /^N[1-5]$/.test(options.level)) {
      levelClause = ' AND jlpt_level = ?';
      params.push(options.level);
    }
    const limit = Math.min(Math.max(Number(options.limit ?? 50), 1), 100);
    params.push(limit);
    return core.rowsFor(db, `
      SELECT id, kanji, kana, meaning, pos, jlpt_level, example_jp, example_meaning
      FROM words
      WHERE (kanji LIKE ? OR kana LIKE ? OR meaning LIKE ?)
      ${levelClause}
      ORDER BY importance DESC, id ASC
      LIMIT ?
    `, params);
  });
}

module.exports = {
  getStudyHome,
  answerCard,
  undoAnswer,
  saveWordNote,
  searchWords
};
