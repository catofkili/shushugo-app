/*
 * 备考计划：每日最低量、阶段、缺口全由网页同一份 jlpt/plan.ts + jlpt/status.ts 算（src/shared/web.js）。
 * 起点、目标、考期和额度走网页共享层并随学习库同步；WXML 只负责微信原生控件。
 */
const { ensureDatabase, getDatabase, getStatus, saveDatabase } = require('../../runtime/database-store');
const features = require('../../runtime/extended-features');
const core = require('../../core/study-core');
const entitlements = require('../../runtime/entitlements');

const PHASES = { intake: '学习期', consolidate: '巩固期', 'exam-week': '考试周', past: '已过期' };
const pad = (value) => String(value).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const STARTS = [
  { value: 'kana-none', label: '不懂五十音' }, { value: 'kana', label: '会五十音' },
  ...features.web.jlptPlan.JLPT_TARGETS.map((value) => ({ value, label: value }))
];
const FAMILIARITY = { words: '单词', grammar: '语法', kanji: '汉字', confusion: '辨析' };
const kanaChoices = (index) => {
  const kana = features.web.kanaProgress.KANA;
  const options = new Set([kana[index][1]]);
  for (let offset = 7; options.size < 4; offset += 11) options.add(kana[(index + offset) % kana.length][1]);
  return [...options];
};

Page({
  data: {
    ready: false, busy: false, error: '', note: '', setupOpen: false, hasPlan: false,
    starts: STARTS.slice(0, 2), startLevels: STARTS.slice(2), setupStart: 'kana', setupTarget: 'N3', familiarityRows: [],
    examOptions: [], examIndex: 0, selectedExamLabel: '', setupPreview: null, kanaPending: false, kanaCard: null,
    targets: features.web.jlptPlan.JLPT_TARGETS, target: 'N3', examDate: '',
    status: null, planEstimate: null, phaseText: '', shortfallText: '', wordPercent: 0, grammarPercent: 0, sourceText: ''
  },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true });
      if (!this.setup && core.withDb(getDatabase(), () => features.web.levelPlan.shouldShowLevelSetup())) this.openSetup();
      if (await features.web.levelPlan.recalibrateLevelStartingPoint()) await saveDatabase();
      this.load();
      entitlements.notifyTrialExpiry();
    } catch (error) {
      console.error('[jlpt-plan] 读取失败', error);
      this.setData({ error: '先到「单词」下载离线词库。' });
    }
  },

  load() {
    const status = features.jlptPlanStatus();
    const settings = core.withDb(getDatabase(), () => features.web.levelPlan.getLevelPlanSettings());
    const kana = features.web.kanaProgress;
    const progress = settings?.startingLevel === 'kana-none' ? core.withDb(getDatabase(), () => kana.getKanaProgress()) : null;
    const index = progress ? kana.KANA.findIndex(([symbol]) => (progress[symbol] || 0) < 2) : -1;
    const quota = features.web.preferences.getStudyPreferences();
    const access = entitlements.cachedEntitlement();
    const planEstimate = settings ? features.web.planContent.previewLevelPlan({
      startingLevel: settings.startingLevel, familiarity: settings.familiarity, target: status.target,
      examDate: status.examDate, startedOn: features.web.examDates.parseExamDate(settings.startedOn),
      kanaCompleted: settings.startingLevel === 'kana-none' && index < 0
    }) : null;
    const shortfall = features.web.jlptPlan.availableShortfall(status.shortfall, access.active, index >= 0);
    this.setData({
      kanaPending: index >= 0,
      hasPlan: Boolean(settings),
      kanaCard: index >= 0 ? { symbol: kana.KANA[index][0], reading: kana.KANA[index][1], choices: kanaChoices(index), mastered: kana.kanaMasteredCount(progress), total: kana.KANA.length } : null,
      status: { ...status, examDate: dateKey(status.examDate), examDateHuman: features.web.examDates.formatExamDateHuman(status.examDate) },
      planEstimate,
      target: status.target,
      examDate: dateKey(status.examDate),
      sourceText: status.examDateSource === 'manual' ? '手动设置' : '自动估算',
      phaseText: PHASES[status.plan.phase] || status.plan.phase,
      shortfallText: index >= 0 ? '从五十音开始，掌握后解锁新词' : features.web.jlptPlan.shortfallText(shortfall),
      quotaWarning: status.plan.feasible && status.plan.phase === 'intake' ? [
        index < 0 && status.plan.newWords > quota.dailyGoal ? `新词每天需约 ${status.plan.newWords} 个，当前安排 ${quota.dailyGoal} 个` : '',
        access.active && status.plan.newGrammar > quota.grammarDailyGoal ? `新语法每天需约 ${status.plan.newGrammar} 个，当前安排 ${quota.grammarDailyGoal} 个` : ''
      ].filter(Boolean).join('；') : '',
      hasPro: access.active,
      wordPercent: status.coverage.words.total ? Math.round(status.coverage.words.seen / status.coverage.words.total * 100) : 0,
      grammarPercent: status.coverage.grammar.total ? Math.round(status.coverage.grammar.seen / status.coverage.grammar.total * 100) : 0
    });
  },

  openSetup() {
    const previous = core.withDb(getDatabase(), () => features.web.levelPlan.getLevelPlanSettings());
    const dates = features.web.examDates.upcomingExamDates();
    const examOptions = dates.map((date) => ({
      value: dateKey(date), label: `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日${dateKey(date) === '2026-12-06' ? '' : ' · 预计'}`
    }));
    this.setup = {
      startingLevel: previous?.startingLevel || 'kana', target: previous?.target || 'N3',
      familiarity: previous?.familiarity || features.web.levelPlan.familiarityDefaults('kana'),
      examDate: previous?.examDate && examOptions.some((item) => item.value === previous.examDate) ? previous.examDate : examOptions[0].value
    };
    this.setData({ setupOpen: true, setupStart: this.setup.startingLevel, setupTarget: this.setup.target,
      examOptions, examIndex: examOptions.findIndex((item) => item.value === this.setup.examDate),
      selectedExamLabel: examOptions.find((item) => item.value === this.setup.examDate)?.label || '',
      familiarityRows: Object.entries(FAMILIARITY).map(([kind, label]) => ({ kind, label, value: this.setup.familiarity[kind] })) });
    this.updateSetupPreview();
  },
  updateSetupPreview() {
    const value = features.web.planContent.previewLevelPlan({
      startingLevel: this.setup.startingLevel, target: this.setup.target,
      familiarity: this.setup.familiarity,
      examDate: features.web.examDates.parseExamDate(this.setup.examDate)
    });
    this.setData({ setupPreview: value });
  },
  closeSetup() { if (this.data.hasPlan) this.setData({ setupOpen: false }); },
  pickStart(event) {
    const startingLevel = event.currentTarget.dataset.value;
    this.setup.startingLevel = startingLevel;
    this.setup.familiarity = features.web.levelPlan.familiarityDefaults(startingLevel);
    this.setData({ setupStart: startingLevel, familiarityRows: Object.entries(FAMILIARITY).map(([kind, label]) => ({ kind, label, value: this.setup.familiarity[kind] })) });
    this.updateSetupPreview();
  },
  pickSetupTarget(event) { this.setup.target = event.currentTarget.dataset.value; this.setData({ setupTarget: this.setup.target }); this.updateSetupPreview(); },
  pickExam(event) {
    const examIndex = Number(event.detail.value);
    this.setup.examDate = this.data.examOptions[examIndex].value;
    this.setData({ examIndex, selectedExamLabel: this.data.examOptions[examIndex].label });
    this.updateSetupPreview();
  },
  changeFamiliarity(event) {
    const kind = event.currentTarget.dataset.kind;
    this.setup.familiarity[kind] = Number(event.detail.value);
    this.setData({ familiarityRows: this.data.familiarityRows.map((row) => row.kind === kind ? { ...row, value: this.setup.familiarity[kind] } : row) });
    this.updateSetupPreview();
  },
  async saveSetup() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', note: '' });
    try {
      const db = getDatabase();
      await core.withDb(db, () => features.web.levelPlan.saveLevelPlanSettings(this.setup));
      const preset = core.withDb(db, () => features.web.dailyPlan.applyExamPreset(this.setup.target));
      if (this.setup.startingLevel === 'kana-none') core.withDb(db, () => features.web.kanaProgress.deferWordPlanUntilKanaComplete(preset.plan.words.fresh));
      let access = entitlements.cachedEntitlement();
      if (!access.active) {
        try { access = await entitlements.claimLevelPlanTrial(); } catch { /* 领取失败只安排单词。 */ }
      }
      features.web.studyMode.saveStudyMode(access.active ? 'mixed' : 'classic');
      core.withDb(db, () => { features.web.wordApi.refreshTodayWordPlan(); features.web.mixedCards.refreshMixedCardTasks(db); });
      await saveDatabase();
      this.setData({ setupOpen: false, note: access.source === 'trial' && access.active ? '7 天完整计划试用已开始。' : access.active ? '完整计划已启用。' : '计划已创建；当前先安排单词。' });
      this.load();
    } catch (error) {
      console.error('[jlpt-plan] 设定失败', error);
      this.setData({ error: error?.message || '计划创建失败，请稍后重试。' });
    } finally { this.setData({ busy: false }); }
  },
  async answerKana(event) {
    if (this.data.busy || !this.data.kanaCard) return;
    const symbol = this.data.kanaCard.symbol;
    const reading = this.data.kanaCard.reading;
    const correct = event.currentTarget.dataset.reading === reading;
    this.setData({ busy: true });
    try {
      const db = getDatabase();
      const result = core.withDb(db, () => features.web.kanaProgress.recordKanaAnswer(symbol, correct));
      if (result.completed) core.withDb(db, () => features.web.wordApi.refreshTodayWordPlan());
      await saveDatabase();
      this.load();
      this.setData({ note: result.completed ? '五十音完成，新词计划已解锁。' : correct ? '答对了' : `读音是 ${reading}，再来一次` });
    } catch (error) { this.setData({ error: error?.message || '假名作答保存失败。' }); }
    finally { this.setData({ busy: false }); }
  },
  startWords() { wx.switchTab({ url: '/pages/index/index' }); },
  openDailyPlan() { wx.navigateTo({ url: '/pages/daily-plan/index' }); }
});
