/*
 * 查词汇量：算法整个来自网页（src/shared/web.js 的 vocabTest），页面只管三件事：
 * 计时（读音 15 秒 / 释义 10 秒，超时按「不认识」记）、切后台暂停并把离开的时间从本题用时里减掉、
 * 展示。进这一页永远先看落地页（`view` 初值恒为 intro），和网页同一条规则。
 */
const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const { vocabTest } = require('../../runtime/extended-features');

const STALE_RESUME_MS = 30 * 60 * 1000;
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
const SHARE_LEVELS = [...LEVELS, 'N1+'];

const pad = (value) => String(value).padStart(2, '0');
const dateKey = (timestamp) => { const d = new Date(timestamp); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const formatGap = (ms) => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '不到一分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} 小时` : `${Math.round(hours / 24)} 天`;
};
const formatDuration = (seconds) => (seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`);
const feedbackText = (state) => ({ correct: '答对了', wrong: '答错了', unknown: '记为不认识', timeout: '超时，记为不认识' })[state] || '';
const safeCount = (value) => Math.max(0, Math.min(999999, Number.parseInt(value, 10) || 0));

const vocabShare = (result) => {
  if (!result) return null;
  const answered = safeCount(result.answered);
  const tooFew = answered < 15;
  const values = {
    share: 'vocab',
    scoringVersion: result.scoreVersion === 2 ? 2 : 1,
    answered,
    total: safeCount(result.totalQuestions),
    estimate: safeCount(result.estimated),
    lower: safeCount(result.lower),
    upper: safeCount(result.upper),
    confidence: safeCount(result.confidence),
    duration: safeCount(result.durationSeconds),
    recommendation: SHARE_LEVELS.includes(result.recommendation) ? result.recommendation : 'N5'
  };
  return {
    title: tooFew ? `我测了日语词汇量，答了 ${answered} 题` : `我的日语词汇量约 ${values.estimate} 词，可信度 ${values.confidence}%`,
    query: Object.entries(values).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')
  };
};

const historyRow = (row) => ({
  ...row,
  tooFew: row.answered < 15,
  date: dateKey(row.finishedAt),
  range: `${row.lower}–${row.upper}`,
  duration: formatDuration(row.durationSeconds)
});

const resultView = (result) => result && ({
  ...result,
  tooFew: result.answered < 15,
  levels: result.levels.map((level) => ({
    ...level,
    percent: level.rate == null ? 0 : Math.round(level.rate * 100),
    label: level.rate == null ? '未答' : `${Math.round(level.rate * 100)}%`
  }))
});

Page({
  data: {
    view: 'intro',
    ready: false,
    error: '',
    history: [],
    latest: null,
    resume: null,
    session: null,
    question: null,
    shown: null,
    feedback: null,
    remaining: 0,
    progress: '',
    result: null,
    sharedResult: null,
    levels: LEVELS
  },

  timer: null,
  questionStartedAt: 0,
  hiddenAt: 0,

  async onLoad(options = {}) {
    if (options.share === 'vocab') {
      wx.hideShareMenu();
      const answered = safeCount(options.answered);
      this.setData({
        view: 'shared',
        sharedResult: {
          answered,
          totalQuestions: safeCount(options.total),
          scoreVersion: Number(options.scoringVersion) === 2 ? 2 : 1,
          estimated: safeCount(options.estimate),
          lower: safeCount(options.lower),
          upper: safeCount(options.upper),
          confidence: safeCount(options.confidence),
          duration: formatDuration(safeCount(options.duration)),
          recommendation: SHARE_LEVELS.includes(options.recommendation) ? options.recommendation : 'N5',
          tooFew: answered < 15
        }
      });
      return;
    }
    wx.hideShareMenu();
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true });
      this.refreshHome();
    } catch (error) {
      console.error('[vocab-test] 词库未就绪', error);
      this.setData({ error: '先到「单词」下载离线词库，再来测词汇量。' });
    }
  },

  onShow() {
    if (this.data.view === 'shared') return;
    // 切回来：把离开的这段从本题用时里减掉（计时器停了不等于账没记）
    if (this.hiddenAt) {
      this.questionStartedAt += Date.now() - this.hiddenAt;
      this.hiddenAt = 0;
    }
    if (this.data.view === 'quiz' && this.data.question && !this.data.feedback) this.startTimer();
  },

  onHide() {
    this.hiddenAt = Date.now();
    this.stopTimer();
  },

  onUnload() { this.stopTimer(); },

  refreshHome() {
    const history = vocabTest.history().map(historyRow);
    const session = vocabTest.session();
    const resumable = Boolean(session && !session.finishedAt && session.responses.length > 0);
    let resume = null;
    if (resumable) {
      const last = session.responses[session.responses.length - 1];
      const idleMs = Date.now() - (last ? last.answeredAt : session.startedAt);
      resume = {
        progress: `${session.responses.length} / ${session.plannedTotal}`,
        startedAt: dateKey(session.startedAt),
        gap: formatGap(idleMs),
        stale: idleMs >= STALE_RESUME_MS
      };
    }
    const finished = session && session.finishedAt && session.responses.length > 0 ? session : null;
    this.setData({ history, latest: history.find((row) => !row.tooFew) || null, resume, session, hasResult: Boolean(finished), view: 'intro', feedback: null });
    wx.hideShareMenu();
  },

  /* ---------- 出题 / 作答 ---------- */

  begin() {
    this.setData({ error: '' });
    try {
      const session = vocabTest.start();
      this.enter(session);
    } catch (error) {
      console.warn('[vocab-test] 开不了场', error);
      this.setData({ error: '当前词库可用于测验的词太少，暂时无法开始。' });
    }
  },

  resume() {
    const session = vocabTest.session();
    if (!session || session.finishedAt) { this.refreshHome(); return; }
    this.enter(session);
  },

  enter(session) {
    const question = session.currentIndex < session.questions.length ? session.questions[session.currentIndex] : null;
    if (!question) { this.showResult(session); return; }
    this.setData({ view: 'quiz', session, question, shown: this.decorate(question, null), feedback: null, progress: `${session.currentIndex + 1} / ${session.plannedTotal}` });
    this.resetClock(question);
  },

  decorate(question, feedback) {
    return {
      ...question,
      kindLabel: question.kind === 'reading' ? '读音' : '释义',
      seconds: vocabTest.secondsForQuestion(question),
      options: question.options.map((text, index) => ({
        text,
        index,
        state: !feedback ? '' : index === question.answerIndex ? 'correct' : feedback.selected === index ? 'wrong' : 'muted'
      }))
    };
  },

  resetClock(question) {
    this.questionStartedAt = Date.now();
    this.setData({ remaining: vocabTest.secondsForQuestion(question) });
    this.startTimer();
  },

  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      const remaining = this.data.remaining - 1;
      if (remaining > 0) { this.setData({ remaining }); return; }
      this.stopTimer();
      this.setData({ remaining: 0 });
      this.answer('timeout', null);
    }, 1000);
  },

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  choose(event) {
    const index = Number(event.currentTarget.dataset.index);
    const question = this.data.question;
    if (!question || this.data.feedback) return;
    this.answer(index === question.answerIndex ? 'correct' : 'wrong', index);
  },

  unknown() {
    if (!this.data.question || this.data.feedback) return;
    this.answer('unknown', null);
  },

  answer(state, selected) {
    const question = this.data.question;
    if (!question || this.data.feedback) return;
    this.stopTimer();
    const session = vocabTest.submit(state, selected, Date.now() - this.questionStartedAt);
    if (!session) return;
    const feedback = { state, selected, text: feedbackText(state), answer: question.answer };
    // 展示用的题必须是刚答完那一道：提交那一刻 currentIndex 已经推到下一题了。
    this.setData({ session, feedback, shown: this.decorate(question, feedback) });
  },

  next() {
    const session = this.data.session;
    if (!session) return;
    const atEnd = session.finishedAt || (session.currentIndex >= session.questions.length && session.questions.length >= session.plannedTotal);
    if (atEnd) { this.showResult(session); return; }
    this.enter(session);
  },

  async stop() {
    this.stopTimer();
    const session = await vocabTest.finish();
    if (session) this.showResult(session);
  },

  async showResult(session) {
    this.stopTimer();
    let finished = session;
    if (!finished.finishedAt) finished = await vocabTest.finish();
    else await vocabTest.finish();
    this.setData({ view: 'result', session: finished, feedback: null, result: resultView(vocabTest.result(finished)), history: vocabTest.history().map(historyRow) });
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  },

  openLastResult() {
    const session = vocabTest.session();
    if (session && session.finishedAt) {
      this.setData({ view: 'result', session, result: resultView(vocabTest.result(session)) });
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  onShareAppMessage() {
    const share = vocabShare(this.data.result);
    return share
      ? { title: share.title, path: `/features/vocab-test/index?${share.query}` }
      : { title: '来测测你的日语词汇量', path: '/features/vocab-test/index' };
  },

  onShareTimeline() {
    const share = vocabShare(this.data.result);
    return share ? { title: share.title, query: share.query } : { title: '来测测你的日语词汇量', query: '' };
  },

  backHome() { this.refreshHome(); }
});
