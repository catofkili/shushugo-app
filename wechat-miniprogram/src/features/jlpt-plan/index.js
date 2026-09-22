/*
 * 备考计划：每日最低量、阶段、缺口全由网页同一份 jlpt/plan.ts + jlpt/status.ts 算（src/shared/web.js）。
 * 目标级别 / 考期存在 studyPreferences（wx 存储，键名同网页），不进数据库 —— 和网页一样是本机偏好。
 */
const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const features = require('../../runtime/extended-features');

const PHASES = { intake: '学习期', consolidate: '巩固期', 'exam-week': '考试周', past: '已过期' };
const pad = (value) => String(value).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

Page({
  data: { ready: false, error: '', targets: features.web.jlptPlan.JLPT_TARGETS, target: 'N3', examDate: '', examDateInput: '', status: null, phaseText: '', shortfallText: '', wordPercent: 0, grammarPercent: 0, sourceText: '' },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true });
      this.load();
    } catch (error) {
      console.error('[jlpt-plan] 读取失败', error);
      this.setData({ error: '先到「单词」下载离线词库。' });
    }
  },

  load() {
    const status = features.jlptPlanStatus();
    const prefs = features.jlptPreferences();
    this.setData({
      status: { ...status, examDate: dateKey(status.examDate), examDateHuman: features.web.examDates.formatExamDateHuman(status.examDate) },
      target: status.target,
      examDate: dateKey(status.examDate),
      examDateInput: prefs.examDate || '',
      sourceText: status.examDateSource === 'manual' ? '手动设置' : '自动估算',
      phaseText: PHASES[status.plan.phase] || status.plan.phase,
      shortfallText: features.web.jlptPlan.shortfallText(status.shortfall),
      wordPercent: status.coverage.words.total ? Math.round(status.coverage.words.seen / status.coverage.words.total * 100) : 0,
      grammarPercent: status.coverage.grammar.total ? Math.round(status.coverage.grammar.seen / status.coverage.grammar.total * 100) : 0
    });
  },

  pickTarget(event) { features.saveJlptPreferences({ jlptTarget: event.currentTarget.dataset.value }); this.load(); },
  pickDate(event) { features.saveJlptPreferences({ jlptExamDate: event.detail.value }); this.load(); },
  clearDate() { features.saveJlptPreferences({ jlptExamDate: '' }); this.load(); }
});
