/*
 * 学习页的数据源。**调度、出题、作答、撤销全部是网页的 word-api**（src/shared/web.js）；
 * 这里只负责三件事：把结果摊成 WXML 能直接渲染的形状、按小程序的节奏落盘、
 * 以及照着网页学习页的顺序处理减负卡和压轴卡（它们不是 word-api 的返回值，
 * 而是页面按 stats 自己插进流程的，见 frontend/src/pages/WordStudy.tsx 的 loadNext）。
 */
const { getDatabase, saveDatabase } = require('./database-store');
const core = require('../core/study-core');
const content = require('../shared/content');
const { toView } = require('./card-view');

const web = core.web;

function db() {
  const value = getDatabase();
  core.ensureStudySchema(value);
  return value;
}

/** 卡面用到的出厂内容（题面层、辨析注记、简繁对照、音高重音）在分包里，先确保它们到位。 */
function ready() {
  return content.ready();
}

const isPlanMode = (mode) => !mode || mode === 'classic' || mode === 'mixed';

/*
 * 混合模式：每答 MIXED_EVERY 个单词插一张别的卡，三种轮着来（语法 → 单独汉字 → 疑难连线）。
 * 出的都是网页那同一副牌（同一份 grammar_progress / kanji_char_memory / confusion_progress、
 * 同一个当日清单和配额、同一套 FSRS），所以在哪边答的都算数，进度天然是一份账。
 * ⚠️ 插播卡是「盖在」单词卡上面的：底下那张单词卡照常排好，答完插播清掉就接着背词。
 */
const MIXED_EVERY = 5;
const INTERLEAVE_KINDS = ['grammar', 'kanji', 'confusion'];
let wordsSinceInterleave = 0;
let interleaveIndex = 0;
let interleaveIndexBefore = 0;

const grammarLevel = () => web.preferences.getStudyPreferences().jlptTarget;

function interleaveCard(database, kind) {
  if (kind === 'grammar') {
    const session = web.grammarQuiz.getGrammarQuizSession(grammarLevel());
    return session.card ? { kind, card: session.card, canUndo: session.canUndo } : null;
  }
  if (kind === 'kanji') {
    const session = web.mixedCards.getKanjiCardSession(database);
    return session.card ? { kind, card: session.card } : null;
  }
  const session = web.mixedCards.getConfusionCardSession(database);
  return session.card ? { kind, card: normalizeMatching(session.card) } : null;
}

/** 辨析卡的 notes 是 Map，WXML 只认普通对象；顺手把每个词的注记贴到成员上。 */
function normalizeMatching(card) {
  const notes = card.notes instanceof Map ? Object.fromEntries(card.notes) : (card.notes || {});
  return {
    ...card,
    notes,
    members: card.members.map((member) => ({ ...member, note: notes[String(member.id)] || '' }))
  };
}

/** 该不该插播：答够 MIXED_EVERY 个单词就找一张，三种轮询，今天都空了就不插。 */
function nextInterleave(database, mode, { force = false } = {}) {
  if (mode !== 'mixed') return null;
  if (!force) {
    wordsSinceInterleave += 1;
    if (wordsSinceInterleave < MIXED_EVERY) return null;
  }
  wordsSinceInterleave = 0;
  for (let step = 0; step < INTERLEAVE_KINDS.length; step += 1) {
    const kind = INTERLEAVE_KINDS[(interleaveIndex + step) % INTERLEAVE_KINDS.length];
    const next = interleaveCard(database, kind);
    if (next) {
      interleaveIndexBefore = interleaveIndex;
      interleaveIndex += step + 1;
      return next;
    }
  }
  return null;
}

/** 撤掉刚触发插播的单词后，再答同一张应该仍触发同一种插播。 */
function rewindInterleave() {
  wordsSinceInterleave = MIXED_EVERY - 1;
  interleaveIndex = interleaveIndexBefore;
}

/**
 * 今日流程：减负卡 → 今日计划 → 压轴卡。和网页学习页同一条顺序、同一批判据
 * （减负不写 reviews；压轴走正式 FSRS 但不进今日任务表）。
 */
async function getStudyHome(options = {}) {
  await ready();
  if ((options.mode || 'classic') === 'mixed') await content.readyForKanji();
  const database = db();
  const mode = options.mode || 'classic';
  const direction = core.normalizeDirection(options.direction);
  return core.withDb(database, () => {
    if (isPlanMode(mode) && direction === 'forward') {
      const relief = web.wordApi.getDailyReliefNext();
      if (relief) {
        const session = web.wordApi.continueTodayPlanStudy();
        return view({ card: relief, phase: 'relief', stats: session.stats, canUndo: false }, { mode, direction, relief: true });
      }
    }
    const session = core.sessionFor(database, { direction, mode });
    if (isPlanMode(mode) && direction === 'forward' && !session.card && session.stats.stage1Done) {
      const tail = web.wordApi.getDailyTailNext();
      if (tail) return view({ ...session, card: tail, phase: 'daily-tail' }, { mode, direction, tail: true });
    }
    // 混合模式：单词今天背完之后剩下的三种卡接着上，四种都空了才算今天完成。
    const interleave = !session.card ? nextInterleave(database, mode, { force: true }) : null;
    return { ...view(session, { mode, direction }), interleave };
  });
}

function view(session, { mode, direction, relief = false, tail = false }) {
  const stats = session.stats;
  return {
    card: toView(session.card, { mode, direction, relief, tail }),
    phase: session.phase,
    mode,
    direction,
    canUndo: Boolean(session.canUndo),
    stats: { ...core.todayCounters(stats, { direction, mode }), phase: session.phase, modeCounts: stats.modeCounts, checkins: stats.checkins, dailyStudyStats: stats.dailyStudyStats, encore: stats.encore },
    unitKey: session.unitKey ?? null,
    unitTarget: session.unitTarget ?? null
  };
}

/**
 * 评分。减负卡只推进减负队列（不写 reviews、不动 FSRS）；压轴卡答错要挪到队尾重来。
 * 其余一律走网页的 submitWordAnswer / submitKanjiUnitAnswer。
 */
async function answerCard(wordId, answer, options = {}) {
  const database = db();
  const result = core.withDb(database, () => {
    if (options.relief) {
      web.wordApi.advanceDailyRelief();
      return { relief: true };
    }
    if (options.tail) {
      const good = answer === 'know' || answer === 'known_forever';
      web.wordApi.submitWordAnswer(Number(wordId), answer);
      web.wordApi.advanceDailyTail({ requeue: !good });
      return { tail: true };
    }
    if (options.unitKey) return web.wordApi.submitKanjiUnitAnswer(options.unitKey, answer);
    const submitted = core.recordAnswer(database, wordId, answer, options);
    // 这一下算数了才谈得上插播（和网页学习页同一个顺序：先记账，再看要不要插）
    return { ...submitted, interleave: nextInterleave(database, options.mode) };
  });
  await saveDatabase();
  return result;
}

/* ---------------- 插播卡的评分 / 撤销：全部走网页那三条路 ---------------- */

async function answerInterleave(kind, id, answer) {
  const database = db();
  const result = core.withDb(database, () => {
    if (kind === 'grammar') return web.grammarQuiz.submitGrammarQuizAnswer(grammarLevel(), Number(id), answer);
    if (kind === 'kanji') return web.mixedCards.submitKanjiCardAnswer(String(id), answer);
    return web.mixedCards.submitConfusionCardAnswer(String(id), answer);
  });
  await saveDatabase();
  return result;
}

/**
 * 撤销插播卡。⚠️ 单词和三种插播卡各有一份互不知道对方存在的撤销栈，所以**必须按刚答的那种
 * 分派**（网页那边踩过：答完语法点「上一个」，撤掉的是语法之前那个单词 —— 一次误操作造两笔假数据）。
 * 页面记着栈顶是哪一种（`undoKinds`），插播卡自己那颗撤销按钮只走这条。
 */
async function undoInterleave(kind) {
  const database = db();
  const result = core.withDb(database, () => {
    if (kind === 'grammar') return web.grammarQuiz.undoLastGrammarQuizAnswer(grammarLevel());
    if (kind === 'kanji') return web.mixedCards.undoKanjiCardAnswer();
    return web.mixedCards.undoConfusionCardAnswer();
  });
  await saveDatabase();
  return result;
}

/** 混合模式下答完插播卡：拿同一种的下一张，没有了就回到单词。 */
function nextOfKind(kind) {
  const database = db();
  return core.withDb(database, () => interleaveCard(database, kind));
}

/** 连线卡的四档由连错次数定（0 认识 / 1 模糊 / ≥2 忘记），不让用户点四颗 —— 答案全露着时选分等于灌假数据。 */
const gradeMatching = (mistakes) => Number(mistakes) < 1 ? 'know' : Number(mistakes) < 2 ? 'fuzzy' : 'forgot';

async function undoAnswer(options = {}) {
  const database = db();
  const result = core.undoLastAnswer(database, options);
  if (result.undone) await saveDatabase();
  return result;
}

async function saveWordNote(wordId, note) {
  const database = db();
  const result = core.saveNote(database, wordId, note);
  await saveDatabase();
  return result;
}

/** 词库搜索走网页的 word-library（筛选、记忆色阶、排序都是那一份）。 */
function searchWords(query, options = {}) {
  const database = db();
  return core.withDb(database, () => web.wordLibrary.queryWordLibrary(
    { search: String(query ?? '').trim(), level: options.level || '', sort: 'default' },
    0,
    Math.min(Math.max(Number(options.limit ?? 50), 1), 100)
  ));
}

/** 完成页的加餐（网页的 startEncore，记的是同一笔账）。 */
async function startEncore(size) {
  const database = db();
  const session = core.withDb(database, () => web.wordApi.startEncore(size));
  await saveDatabase();
  return view(session, { mode: 'classic', direction: 'forward' });
}

module.exports = {
  ready,
  getStudyHome,
  answerCard,
  undoAnswer,
  rewindInterleave,
  saveWordNote,
  searchWords,
  startEncore,
  answerInterleave,
  undoInterleave,
  nextOfKind,
  gradeMatching,
  MIXED_EVERY
};
