/* 昨日减负：只是当天演出队列，不是学习记录。绝不写 reviews / progress / FSRS。 */
const core = require('../core/study-core');

const STATE_KEY = 'daily_relief_v2';
const MIN_RELIEF_WORDS = 6;
const MAX_RELIEF_WORDS = 12;
const MIN_ACTIVITY_WORDS = 100;
const MAX_ACTIVITY_WORDS_FOR_FULL_RELIEF = 300;

function previousDay(day) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function empty(day) { return { studyDate: day, wordIds: [], completed: 0 }; }

function readState(db, day) {
  const raw = core.getState(db, STATE_KEY, '');
  if (!raw) return empty(day);
  try {
    const state = JSON.parse(raw);
    if (state.studyDate !== day || !Array.isArray(state.wordIds)) return empty(day);
    const ids = [...new Set(state.wordIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    return { studyDate: day, wordIds: ids, completed: Math.min(Math.max(Number(state.completed || 0), 0), ids.length) };
  } catch { return empty(day); }
}

function reliefCount(candidateCount, studiedWordCount) {
  if (candidateCount < MIN_RELIEF_WORDS || studiedWordCount < MIN_ACTIVITY_WORDS) return 0;
  const ratio = Math.min(1, (studiedWordCount - MIN_ACTIVITY_WORDS) / (MAX_ACTIVITY_WORDS_FOR_FULL_RELIEF - MIN_ACTIVITY_WORDS));
  return Math.min(candidateCount, Math.round(MIN_RELIEF_WORDS + ratio * (MAX_RELIEF_WORDS - MIN_RELIEF_WORDS)));
}

function ensureDailyRelief(db, now = new Date()) {
  core.ensureStudySchema(db);
  const day = core.localStudyDay(now);
  const existing = readState(db, day);
  const raw = core.getState(db, STATE_KEY, '');
  if (existing.wordIds.length || (raw && (() => { try { return JSON.parse(raw).studyDate === day; } catch { return false; } })())) return existing;
  const yesterday = previousDay(day);
  const studied = Number(core.firstValue(db, `SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ? AND direction = 'forward'`, [yesterday], 0));
  const candidates = core.rowsFor(db, `
    SELECT r.word_id, COUNT(*) AS remembered_count, MAX(r.id) AS last_review_id
    FROM reviews r JOIN progress p ON p.word_id = r.word_id
    WHERE r.reviewed_on = ? AND r.direction = 'forward' AND r.answer IN ('know', 'known_forever')
      AND NOT EXISTS (SELECT 1 FROM stage1_tasks t WHERE t.reviewed_on = ? AND t.word_id = r.word_id)
    GROUP BY r.word_id ORDER BY remembered_count ASC, last_review_id ASC, r.word_id ASC LIMIT ?
  `, [yesterday, day, MAX_RELIEF_WORDS]).map((row) => Number(row.word_id));
  const state = { studyDate: day, wordIds: candidates.slice(0, reliefCount(candidates.length, studied)), completed: 0 };
  core.setState(db, STATE_KEY, JSON.stringify(state));
  return state;
}

function nextDailyRelief(db, now = new Date()) {
  const state = ensureDailyRelief(db, now);
  const wordId = state.wordIds[state.completed];
  if (!wordId) return null;
  const card = core.cardById(db, wordId, 'forward');
  return card ? { ...card, relief: true, prompt: card.meaning, answerText: card.surface || card.kanji } : null;
}

function advanceDailyRelief(db, now = new Date()) {
  const state = ensureDailyRelief(db, now);
  if (state.completed < state.wordIds.length) state.completed += 1;
  core.setState(db, STATE_KEY, JSON.stringify(state));
  return state;
}

module.exports = { STATE_KEY, reliefCount, ensureDailyRelief, nextDailyRelief, advanceDailyRelief };
