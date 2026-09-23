/*
 * 小程序的学习核心 = 网页那一份（src/shared/web.js，由 frontend/src/lib 打包而来）。
 *
 * ⚠️ 这个文件以前是 1,048 行手抄的调度器：自己的建表、自己的每日计划、自己的 FSRS 作答、
 * 自己的 direction_tasks / mode_tasks 两张表。它和网页写的是同一批同步表，于是
 * 「差不多一样」的地方全都变成了跨端 bug：排计划口径不同、成就表名不同、语法收藏 id 不同、
 * direction_tasks 这种网页根本不认识的表推上云再被丢掉、删除不留墓碑所以撤销会被对端复活。
 * 2026-09-22 用户定的规则：除了微信自己的机制（登录 / 虚拟支付 / 消息推送）和组队，
 * 一切按网页。所以这里只剩「把小程序的 db-first 调用惯例翻译成网页的隐式当前库」。
 *
 * 网页所有模块都从 lib/database 拿「当前库」；小程序有几条路要对另一个库跑同一套逻辑
 * （内容更新时把进度搬到新库、Node 回归里的临时库），所以每个导出都接受第一个参数 db，
 * 内部用 withDatabase 把当前库临时指过去。
 */
const web = require('../shared/web');

const withDb = (db, run) => web.database.withDatabase(db, run);

/*
 * 建表 + 同步触发器。⚠️ ensureSyncSchema 那一步是关键：网页靠触发器给每张同步表盖
 * sync_updated_at、删除时写墓碑。小程序以前没有触发器，所以「撤销作答」「取消收藏」
 * 在对端下一次合并时会原样复活，而且完全静默。
 */
function ensureStudySchema(db) {
  require('../runtime/legacy-migrations').runLegacyMigrations(db);
  return withDb(db, () => {
    web.studyCore.ensureUserTables();
    web.syncSchema.ensureSyncSchema();
    web.wordApi.ensureProgressInitialized();
    web.levelPlan.hydrateLevelPlanPreferences();
  });
}

/** 只建表、不补 progress 行：内容更新时对着还没填充的新库用。 */
function ensureTablesOnly(db) {
  require('../runtime/legacy-migrations').runLegacyMigrations(db);
  return withDb(db, () => {
    web.studyCore.ensureUserTables();
    web.syncSchema.ensureSyncSchema();
  });
}

const firstValue = (db, sql, params = [], fallback = null) => withDb(db, () => web.dbUtils.firstValue(sql, params, fallback));
const rowsFor = (db, sql, params = []) => withDb(db, () => web.dbUtils.rowsFor(sql, params));
const getState = (db, key, fallback = '') => withDb(db, () => web.dbUtils.getState(key, fallback));
const setState = (db, key, value) => withDb(db, () => web.dbUtils.setState(key, String(value)));
const localStudyDay = (date = new Date()) => web.dbUtils.studyDate(date);
const studyDayEnd = (date = new Date()) => web.dbUtils.studyDayEnd(date);
const isoNow = (date = new Date()) => date.toISOString();

/* ---------------- 今日计划 / 出题 / 作答：全部是网页的 word-api ---------------- */

const PHASE_BY_DIRECTION = { forward: 'stage1', reverse: 'stage2', kanji: 'kanji' };

function normalizeDirection(direction) {
  return direction === 'reverse' || direction === 'kanji' ? direction : 'forward';
}

function sessionFor(db, { direction = 'forward', mode = '' } = {}) {
  return withDb(db, () => {
    if (mode === 'mistakes') return web.wordApi.getWordSession({ focus: 'mistakes' });
    if (mode === 'picked') return web.wordApi.getWordSession({ focus: 'picked' });
    const normalized = normalizeDirection(direction);
    if (normalized === 'reverse') return web.wordApi.continueStage2Study();
    if (normalized === 'kanji') return web.wordApi.continueKanjiStudy();
    return web.wordApi.continueTodayPlanStudy();
  });
}

function wordStatsFor(db, { direction = 'forward', mode = '' } = {}) {
  return withDb(db, () => web.wordApi.getWordStats(
    mode ? 'stage1' : PHASE_BY_DIRECTION[normalizeDirection(direction)],
    mode === 'mistakes' ? { focus: 'mistakes' } : mode === 'picked' ? { focus: 'picked' } : {}
  ));
}

/**
 * 页面要的那几个数。**口径来自网页的 WordStats，别在这里另算一份**：
 * 「完成」= 熟知或下次到期越过本学习日边界，不是「答过就算」。
 */
function todayCounters(wordStats, { direction = 'forward', mode = '' } = {}) {
  const normalized = normalizeDirection(direction);
  if (mode === 'mistakes') {
    const planned = wordStats.mistakes.poolSize;
    const completed = wordStats.mistakes.answeredToday;
    return { planned, completed, remaining: Math.max(planned - completed, 0), answered: wordStats.reviewedToday, newAnswered: 0, dueTotal: wordStats.lowCount };
  }
  if (normalized === 'reverse') {
    return { planned: wordStats.stage2Total, completed: wordStats.stage2Completed, remaining: Math.max(wordStats.stage2Total - wordStats.stage2Completed, 0), answered: wordStats.reviewedToday, newAnswered: 0, dueTotal: wordStats.stage2Total };
  }
  if (normalized === 'kanji') {
    return { planned: wordStats.kanjiTotal, completed: wordStats.kanjiCompleted, remaining: Math.max(wordStats.kanjiTotal - wordStats.kanjiCompleted, 0), answered: wordStats.reviewedToday, newAnswered: 0, dueTotal: wordStats.kanjiTotal };
  }
  return {
    planned: wordStats.stage1ProgressTotal,
    completed: wordStats.stage1ProgressDone,
    remaining: Math.max(wordStats.stage1ProgressTotal - wordStats.stage1ProgressDone, 0),
    answered: wordStats.reviewedToday,
    newAnswered: wordStats.stage1NewDone,
    dueTotal: wordStats.lowCount,
    newTotal: wordStats.stage1NewTotal,
    newDone: wordStats.stage1NewDone,
    reviewTotal: wordStats.stage1ReviewTotal,
    reviewDone: wordStats.stage1ReviewDone,
    reliefTotal: wordStats.dailyRelief.total,
    reliefCompleted: wordStats.dailyRelief.completed,
    planDone: wordStats.dailyPlanDone
  };
}

/** 排今天的计划：网页的 refreshTodayWordPlan 是「补抽」——只删没答的行，答过的留着。 */
function createTodayPlan(db) {
  return withDb(db, () => {
    const refreshed = web.wordApi.refreshTodayWordPlan();
    return { day: refreshed.studyDate, planned: refreshed.stage1ProgressTotal };
  });
}

function nextCard(db, options = {}) {
  return sessionFor(db, options).card;
}

function cardById(db, wordId) {
  return withDb(db, () => web.wordApi.wordCardById(Number(wordId)));
}

function recordAnswer(db, wordId, answer, options = {}) {
  return withDb(db, () => {
    if (options.mode === 'quick') {
      // 快速学习是批次评分；网页那条路也是一条一条走 submitWordAnswer。
      return web.wordApi.submitQuickStudyBatch([{ wordId: Number(wordId), answer }], 'stage1');
    }
    const focus = options.mode === 'mistakes' ? { focus: 'mistakes' } : options.mode === 'picked' ? { focus: 'picked' } : {};
    return web.wordApi.submitWordAnswer(Number(wordId), answer, focus);
  });
}

function undoLastAnswer(db, options = {}) {
  return withDb(db, () => {
    const before = web.dbUtils.firstValue('SELECT COUNT(*) FROM reviews', [], 0);
    const focus = options.mode === 'mistakes' ? { focus: 'mistakes' } : options.mode === 'picked' ? { focus: 'picked' } : {};
    const result = web.wordApi.undoLastWordAnswer(focus);
    const after = web.dbUtils.firstValue('SELECT COUNT(*) FROM reviews', [], 0);
    return after < before
      ? { undone: true, session: result }
      : { undone: false, reason: '没有可撤销的作答', session: result };
  });
}

function saveNote(db, wordId, note) {
  return withDb(db, () => web.wordApi.updateWordNote(Number(wordId), String(note ?? '')));
}

function ensureGrammarSchema(db) {
  return withDb(db, () => {
    web.studyCore.ensureUserTables();
    web.grammarApi.ensureGrammarProgressInitialized();
  });
}

/** 收藏 / 词汇量 / 柚子 / 周报这些表也由网页的 local-schema 建；这个名字留着是为了少改调用方。 */
const ensureFeatureSchema = ensureStudySchema;

module.exports = {
  web,
  withDb,
  ensureStudySchema,
  ensureTablesOnly,
  ensureFeatureSchema,
  ensureGrammarSchema,
  firstValue,
  rowsFor,
  getState,
  setState,
  localStudyDay,
  studyDayEnd,
  isoNow,
  normalizeDirection,
  sessionFor,
  wordStatsFor,
  todayCounters,
  createTodayPlan,
  nextCard,
  cardById,
  recordAnswer,
  undoLastAnswer,
  saveNote
};
