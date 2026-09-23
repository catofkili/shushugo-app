/*
 * 可练的辨析题。**题面、选项、跳过规则、结算全部是网页的 distinction-quiz**：
 * 缺人工题面就整组跳过（绝不退回 words.meaning），一组连续出完、最多 24 题，
 * 结算只写 confusion_mastered，不碰 reviews / progress / FSRS / 当日计划。
 */
const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const confusion = require('../../runtime/confusion');
const { cachedEntitlement } = require('../../runtime/entitlements');
const { canUse } = require('../../core/entitlements');

const SCOPES = [
  { id: 'all', label: '全部辨析组', scope: { kind: 'type', type: '' } },
  { id: 'today', label: '今天学过的', scope: { kind: 'today' } },
  { id: 'learned', label: '已学范围', scope: { kind: 'learned' } }
];

Page({
  data: {
    state: 'intro', locked: false, error: '',
    scopes: SCOPES.map((item) => ({ id: item.id, label: item.label })), scopeIndex: 0,
    questions: [], index: 0, question: null, selected: 0, revealed: false,
    correct: 0, groupResults: {}, note: ''
  },

  async onLoad() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ locked: !canUse('confusion-groups', cachedEntitlement()) });
    } catch (error) {
      console.error('[distinction-quiz] 初始化失败', error);
      this.setData({ error: '暂时无法读取，请稍后重试' });
    }
  },

  goPro() { wx.navigateTo({ url: '/pages/settings/index' }); },

  pickScope(event) { this.setData({ scopeIndex: Number(event.detail.value) }); },

  async start() {
    try {
      const scope = SCOPES[this.data.scopeIndex].scope;
      const questions = await confusion.quizQuestions(scope.kind === 'type' && !scope.type ? { kind: 'all' } : scope);
      if (!questions.length) {
        this.setData({ error: '这个范围里还没有可练的辨析题（缺人工题面的组会整组跳过）。' });
        return;
      }
      this.setData({ state: 'quiz', questions, index: 0, question: this.decorate(questions[0]), selected: 0, revealed: false, correct: 0, groupResults: {}, error: '' });
    } catch (error) {
      console.error('[distinction-quiz] 出题失败', error);
      this.setData({ error: '暂时无法出题，请稍后重试' });
    }
  },

  decorate(question) {
    // notes 是 Map（每个成员一句组内注记），WXML 只认普通对象
    const notes = question.notes instanceof Map ? Object.fromEntries(question.notes) : (question.notes || {});
    return { ...question, notes, options: question.options.map((option) => ({ ...option, note: notes[String(option.id)] || '' })) };
  },

  answer(event) {
    if (this.data.revealed) return;
    const selected = Number(event.currentTarget.dataset.id);
    const question = this.data.question;
    const right = selected === question.answerId;
    const groupResults = { ...this.data.groupResults };
    groupResults[question.groupKey] = (groupResults[question.groupKey] !== false) && right;
    this.setData({ selected, revealed: true, correct: this.data.correct + (right ? 1 : 0), groupResults, note: question.summary || '' });
  },

  async next() {
    const index = this.data.index + 1;
    if (index >= this.data.questions.length) {
      // 一组里每道题都答对才算掌握（settleGroup 只写 confusion_mastered）
      for (const [groupKey, allCorrect] of Object.entries(this.data.groupResults)) {
        await confusion.settleQuizGroup(groupKey, allCorrect);
      }
      this.setData({ state: 'result' });
      return;
    }
    this.setData({ index, question: this.decorate(this.data.questions[index]), selected: 0, revealed: false, note: '' });
  }
});
