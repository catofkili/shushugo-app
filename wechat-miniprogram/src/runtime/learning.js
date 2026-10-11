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
 * 混合模式：单词 / 语法 / 单独汉字 / 疑难连线四种卡一条队列。下一张出哪一种、今天算不算完、
 * 「上一个」撤哪一种，全部由网页的 lib/mixed-session 判（web.mixedSession，和网页学习页同一份源码）；
 * 这里只把它给的卡摊成 WXML 能渲染的形状。
 * ⚠️ 别的卡是「盖在」单词卡上面的：底下那张单词卡照常排好，答完别的卡清掉就接着背词。
 */
const mixed = web.mixedSession;

function toOtherView(item) {
  if (!item) return null;
  return item.kind === 'confusion' ? { kind: item.kind, card: normalizeMatching(item.card) } : { kind: item.kind, card: item.card };
}

/** 问队列：单词那边有没有下一张 → 该出哪一种。只在混合模式问；返回别的卡（或 null）。 */
function pickOther(mode, { word, afterWord = false }) {
  if (mode !== 'mixed') return null;
  const pick = mixed.pickMixedNext({ word, afterWord });
  return pick && pick !== 'word' ? toOtherView(pick) : null;
}

/** 辨析卡的 notes 是 Map，WXML 只认普通对象；顺手把每个词的注记贴到成员上。 */
function normalizeMatching(card) {
  const notes = card.notes instanceof Map ? Object.fromEntries(card.notes) : (card.notes || {});
  return {
    ...card,
    overview: card.overview || String(card.summary || '').split(/[；;]/)[0].trim(),
    notes,
    members: card.members.map((member) => ({ ...member, note: notes[String(member.id)] || '' }))
  };
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
    // 混合模式：单词今天背完之后剩下的三种卡接着上，四种都空了才算今天完成（队列说了算）。
    // 屏幕上已经摆着一张别的卡时不问：问一次就推进一次轮次，问出来的又用不上。
    const interleave = !session.card && !options.otherShowing ? pickOther(mode, { word: false }) : null;
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
    // 这一下算数了才谈得上轮到别的卡（和网页学习页同一个顺序：先记账，再问队列）。
    // 压轴卡也是单词作答，一样计数、一样进撤销顺序（网页那边一直是这样，小程序原来漏了）。
    const afterWord = () => {
      mixed.recordMixedWordAnswer();
      return pickOther(options.mode, { word: true, afterWord: true });
    };
    if (options.tail) {
      const good = answer === 'know' || answer === 'known_forever';
      web.wordApi.submitWordAnswer(Number(wordId), answer);
      web.wordApi.advanceDailyTail({ requeue: !good });
      return { tail: true, interleave: afterWord() };
    }
    if (options.unitKey) return web.wordApi.submitKanjiUnitAnswer(options.unitKey, answer);
    const submitted = core.recordAnswer(database, wordId, answer, options);
    return { ...submitted, interleave: afterWord() };
  });
  await saveDatabase();
  return result;
}

/* ---------------- 插播卡的评分 / 撤销：全部走网页那三条路 ---------------- */

async function answerInterleave(item, answer) {
  const database = db();
  core.withDb(database, () => mixed.answerMixedOther(item, answer));
  await saveDatabase();
}

/**
 * 撤销栈顶那张别的卡，返回要重新摆出来的那张。⚠️ 单词和三种别的卡各有一份互不知道对方存在的撤销栈，
 * 所以**必须按刚答的那种分派** —— 分派和栈都在 lib/mixed-session（网页踩过：答完语法点「上一个」，
 * 撤掉的是语法之前那个单词，一次误操作造两笔假数据）。
 */
async function undoInterleave() {
  const database = db();
  const item = core.withDb(database, () => mixed.undoMixedOther());
  await saveDatabase();
  return toOtherView(item);
}

/** 单词那份撤销做完之后调：撤的若是带出别的卡的那个单词，计数和轮次一起退回。 */
function undoWordInQueue(otherShowing) {
  mixed.undoMixedWord({ otherShowing });
}

/** 「上一个」现在撤哪一种、亮不亮（判据在 lib/mixed-session）。 */
function undoState(mode, wordCanUndo = true) {
  return { kind: mixed.mixedUndoKind(), enabled: mixed.canUndoMixed(mode === 'mixed', wordCanUndo) };
}

/** 进学习页、切学习模式时清零队列的会话状态。 */
function resetQueue() {
  mixed.resetMixedSession();
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
  saveWordNote,
  searchWords,
  startEncore,
  answerInterleave,
  undoInterleave,
  undoWordInQueue,
  undoState,
  resetQueue,
  gradeMatching
};
