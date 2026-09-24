const {
  ensureDatabase,
  getDatabase,
  getStatus,
  restoreDatabase
} = require('../../runtime/database-store');
const {
  answerCard,
  answerInterleave,
  getStudyHome,
  nextOfKind,
  saveWordNote,
  undoAnswer,
  undoInterleave,
  rewindInterleave
} = require('../../runtime/learning');
const { playWordAudio } = require('../../runtime/audio');
const { bank: bankReminder } = require('../../runtime/reminder');
const { confusionGroupsForWordWithDb } = require('../../runtime/confusion');
const { cachedEntitlement, notifyTrialExpiry } = require('../../runtime/entitlements');
const { canUse } = require('../../core/entitlements');
const core = require('../../core/study-core');
const { web } = core;

const KANJI_ROW_PITCH = 112;
const KANJI_GUTTER = 64;

const kanjiMatchView = (question, readings, pairs, selectedWord, revealed) => {
  const items = question?.items || [];
  const lines = [];
  const addLine = (wordIndex, readingIndex, kind) => {
    const deltaY = (readingIndex - wordIndex) * KANJI_ROW_PITCH;
    const angle = Math.atan2(deltaY, KANJI_GUTTER) * 180 / Math.PI;
    lines.push({
      index: lines.length,
      kind,
      style: `top:${wordIndex * KANJI_ROW_PITCH + KANJI_ROW_PITCH / 2}rpx;transform:translateY(-50%) rotate(${angle}deg)`
    });
  };

  items.forEach((item, wordIndex) => {
    const assigned = pairs[wordIndex];
    const correct = readings.indexOf(item.targetReading);
    if (revealed) {
      if (assigned !== undefined && assigned !== correct) addLine(wordIndex, assigned, 'wrong');
      if (correct >= 0) addLine(wordIndex, correct, 'correct');
    } else if (assigned !== undefined) addLine(wordIndex, assigned, 'attempt');
  });

  const pairedReadings = new Set(Object.values(pairs));
  return {
    kanjiWordRows: items.map((item, index) => ({ ...item, index, selected: selectedWord === index, paired: pairs[index] !== undefined })),
    kanjiReadingRows: readings.map((reading, index) => ({
      index,
      reading,
      paired: pairedReadings.has(index),
      correct: revealed && items.some((item, wordIndex) => item.targetReading === reading && pairs[wordIndex] === index)
    })),
    kanjiConnections: lines,
    kanjiMatchComplete: items.length > 0 && Object.keys(pairs).length === items.length
  };
};

Page({
  data: {
    busy: false,
    result: '',
    status: { ready: false },
    statusText: '等待初始化',
    detailText: '首次使用需要下载离线词库。',
    card: null,
    answerVisible: false,
    stats: { planned: 0, completed: 0, remaining: 0, answered: 0, newAnswered: 0, dueTotal: 0 },
    selectedLevel: '',
    levelIndex: 0,
    noteDraft: '',
    levels: ['', 'N5', 'N4', 'N3', 'N2', 'N1'],
    direction: 'forward',
    directionIndex: 0,
    directions: ['正向：日语 → 中文', '反向：中文 → 日语', '汉字读音：表记 → 读音'],
    mode: 'classic',
    modeLabel: '经典模式',
    // 混合模式的插播卡「盖在」单词卡上面：{ kind: grammar|kanji|confusion, card }
    interleave: null,
    interleaveRevealed: false,
    kanjiReadings: [],
    kanjiPairs: {},
    selectedKanjiWord: null,
    kanjiWordRows: [],
    kanjiReadingRows: [],
    kanjiConnections: [],
    kanjiMatchComplete: false,
    // 跟网页的 UNDO_LIMIT=2 对齐；只记本次进入页面后的作答顺序。
    undoKinds: [],
    swipeStyle: '', swipeStamp: '',
    sharedDaily: null
  },

  onLoad(options = {}) {
    if (options.share === 'daily') {
      wx.hideShareMenu();
      const number = (value) => Math.max(0, Math.min(999999, Number.parseInt(value, 10) || 0));
      this.setData({ sharedDaily: { completed: number(options.completed), planned: number(options.planned) } });
      return;
    }
    const mode = ['quick', 'mistakes', 'mixed'].includes(options.mode) ? options.mode : 'classic';
    const direction = ['forward', 'reverse', 'kanji'].includes(options.direction) ? options.direction : 'forward';
    const directionIndex = ['forward', 'reverse', 'kanji'].indexOf(direction);
    this.setData({
      mode,
      modeLabel: mode === 'quick' ? '快速学习' : mode === 'mistakes' ? '错题本' : mode === 'mixed' ? '混合学习' : '经典模式',
      direction,
      directionIndex
    });
    wx.hideShareMenu();
  },

  shareDailyQuery() {
    const completed = Math.max(0, Number(this.data.stats.completed) || 0);
    const planned = Math.max(0, Number(this.data.stats.planned) || 0);
    return `share=daily&completed=${completed}&planned=${planned}`;
  },

  shareDailyTitle() {
    const completed = Number(this.data.stats.completed) || 0;
    return completed ? `我今天完成了 ${completed} 个单词，一起学日语！` : '一起学日语，今天也进步一点！';
  },

  onShareAppMessage() {
    return {
      title: this.shareDailyTitle(),
      path: `/pages/index/index?${this.shareDailyQuery()}`
    };
  },

  onShareTimeline() {
    return {
      title: this.shareDailyTitle(),
      query: this.shareDailyQuery()
    };
  },

  onShow() {
    if (this.data.sharedDaily) return;
    const selected = getApp().globalData.pendingStudyMode;
    if (selected) {
      delete getApp().globalData.pendingStudyMode;
      const direction = selected === 'reverse' || selected === 'kanji' ? selected : 'forward';
      const mode = direction === 'forward' ? selected : 'classic';
      this.setData({ mode, modeLabel: web.studyMode.studyModeInfo(selected).title, direction, directionIndex: ['forward', 'reverse', 'kanji'].indexOf(direction), undoKinds: [] });
    }
    this.refreshStatus();
    if (getStatus().ready) {
      notifyTrialExpiry();
      if (this.data.mode === 'mixed' && !cachedEntitlement().active) this.setData({ mode: 'classic', modeLabel: '经典模式', interleave: null });
      this.refreshHome();
    }
    else if (!this.data.busy) this.autoRestore();
  },

  // 本机已有库就直接打开，不再每次冷启动都让人点「初始化」；没有库才停在按钮上 ——
  // 首次要下 11 MB，得让人自己点。
  autoRestore() {
    this.run('恢复本地库', async () => {
      try { await restoreDatabase(); } catch { return '还没有本地库'; }
      await this.refreshHome();
      return '已恢复';
    });
  },

  refreshStatus() {
    const status = getStatus();
    this.setData({
      status,
      statusText: status.ready ? '离线库已就绪' : '等待初始化',
      detailText: status.ready
        ? '词库已保存在本机，可以断网学习。'
        : '首次使用需要下载离线词库。'
    });
  },

  async refreshHome() {
    if (!getStatus().ready) return;
    try {
      const home = await getStudyHome({
        level: this.data.selectedLevel || undefined,
        direction: this.data.direction,
        mode: this.data.mode === 'classic' ? undefined : this.data.mode
      });
      this.setData({
        // 辨析是 Pro：没权益不算分组，卡上只留一行入口（点进去是付费墙）
        card: home.card ? { ...home.card, confusions: canUse('confusion-groups', cachedEntitlement()) ? confusionGroupsForWordWithDb(getDatabase(), home.card.id) : [] } : null,
        confusionsLocked: !canUse('confusion-groups', cachedEntitlement()),
        stats: home.stats,
        answerVisible: false,
        noteDraft: home.card?.note || ''
      });
      const shareReady = !home.card && !home.interleave && Number(home.stats.completed) > 0;
      if (shareReady) wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
      else wx.hideShareMenu();
      // ⚠️ 屏幕上已经有插播卡时不许动它：插播卡作答前要留在屏幕上显示答案和评分，
      // 而 refreshHome 是在那次记账里被调用的 —— 覆盖掉的话卡片当场消失，连错次数也被清零。
      if (!this.data.interleave) this.showInterleave(home.interleave || null);
      const app = getApp();
      if (!app.globalData.levelSetupPrompted && core.withDb(getDatabase(), () => web.levelPlan.shouldShowLevelSetup())) {
        app.globalData.levelSetupPrompted = true;
        wx.navigateTo({ url: '/features/jlpt-plan/index' });
      }
    } catch (error) {
      console.error('[study] 刷新首页失败', error);
      this.setData({ result: '读取今日任务失败，请稍后重试' });
    }
  },

  async run(label, task) {
    if (this.data.busy) return;
    this.setData({ busy: true, result: `${label}…` });
    try {
      const result = await task();
      this.setData({ result: `${label}完成：${result || 'OK'}` });
      this.refreshStatus();
    } catch (error) {
      console.error(`[study] ${label}失败`, error);
      this.setData({ result: `${label}失败，请稍后重试` });
      wx.showToast({ title: '操作失败，请稍后重试', icon: 'none', duration: 2600 });
    } finally {
      this.setData({ busy: false });
    }
  },

  handleInit() {
    this.run('初始化本地库', async () => {
      const db = await ensureDatabase();
      const row = db.exec('SELECT COUNT(*) FROM words')[0]?.values?.[0]?.[0] ?? 0;
      await this.refreshHome();
      return `${row.toLocaleString()} 条词汇已就绪`;
    });
  },

  handleReveal() {
    bankReminder();
    if (this.data.card && !this.data.answerVisible) {
      this.setData({ answerVisible: true });
      if (web.preferences.getStudyPreferences().zooSounds) web.sounds.playFlip();
    }
  },

  handleAudio() {
    const card = this.data.card;
    if (!card) return;
    this.run('播放读音', async () => {
      const result = await playWordAudio(card.kanji, card.kana);
      return result.played ? '已播放' : result.reason;
    });
  },

  handleAnswer(event) {
    bankReminder();
    const answer = event.currentTarget.dataset.answer;
    const card = this.data.card;
    if (!card || !answer || this.data.busy || this.flinging) return;
    this.run('记录作答', async () => {
      const result = await answerCard(card.id, answer, { direction: this.data.direction, mode: this.data.mode, relief: Boolean(card.relief), tail: Boolean(card.tail) });
      if (web.preferences.getStudyPreferences().zooSounds) {
        if (card.relief) web.sounds.playReliefDeal();
        else if (answer === 'know' || answer === 'known_forever') web.sounds.playKnow(this.correctStreak || 0);
        else web.sounds.playDontKnow();
      }
      this.correctStreak = answer === 'know' || answer === 'known_forever' ? (this.correctStreak || 0) + 1 : 0;
      // 先刷新（把下一张单词卡摆好），再把插播卡盖上去。
      await this.refreshHome();
      if (result && result.interleave) this.showInterleave(result.interleave);
      if (!card.relief) this.pushUndo('word');
      if (!this.data.card && !this.data.interleave && web.preferences.getStudyPreferences().zooSounds) web.sounds.playComplete();
      return card.relief ? '减负卡已看完（不改记忆数据）' : answer === 'forgot' ? '已安排稍后重学' : '已保存到本地库';
    });
  },

  // 看过答案后才允许甩卡。横向 96px 才提交，右=认识、左=忘记；纵向仍交给页面滚动。
  wordTouchStart(event) {
    if (!this.data.card || !this.data.answerVisible || this.data.busy || this.flinging || this.data.interleave || event.target?.dataset?.noSwipe) return;
    const touch = event.touches?.[0];
    if (touch) this.swipeGesture = { x: touch.clientX, y: touch.clientY, axis: '' };
  },

  wordTouchMove(event) {
    const gesture = this.swipeGesture, touch = event.touches?.[0];
    if (!gesture || !touch) return;
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
    if (!gesture.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    }
    if (gesture.axis !== 'x') return;
    gesture.dx = dx;
    const angle = Math.max(-4, Math.min(4, dx / 40));
    this.setData({ swipeStyle: `transform: translate3d(${dx}px,0,0) rotate(${angle}deg); transition: none`, swipeStamp: Math.abs(dx) >= 8 ? dx > 0 ? '认识' : '再来' : '' });
  },

  wordTouchEnd() {
    const gesture = this.swipeGesture;
    this.swipeGesture = null;
    if (!gesture || gesture.axis !== 'x' || Math.abs(gesture.dx || 0) < 96) {
      this.setData({ swipeStyle: '', swipeStamp: '' });
      return;
    }
    const answer = gesture.dx > 0 ? 'know' : 'forgot', cardId = this.data.card?.id;
    this.flinging = true;
    this.setData({ swipeStyle: `transform: translate3d(${gesture.dx > 0 ? 900 : -900}px,0,0) rotate(${gesture.dx > 0 ? 4 : -4}deg); opacity: 0; transition: transform 240ms ease-in, opacity 240ms ease-in`, swipeStamp: '' });
    this.flingTimer = setTimeout(() => {
      this.flinging = false;
      this.setData({ swipeStyle: '' });
      if (this.data.card?.id === cardId) this.handleAnswer({ currentTarget: { dataset: { answer } } });
    }, 240);
  },

  onHide() {
    if (this.flingTimer) clearTimeout(this.flingTimer);
    this.flinging = false;
    this.swipeGesture = null;
    this.setData({ swipeStyle: '', swipeStamp: '' });
  },

  pushUndo(kind) {
    this.setData({ undoKinds: [...this.data.undoKinds, kind].slice(-2) });
  },

  popUndo() {
    this.setData({ undoKinds: this.data.undoKinds.slice(0, -1) });
    this.correctStreak = 0;
  },

  /*
   * 撤销按栈顶那一笔分派。⚠️ 混合模式里单词和三种插播卡各有一份互不知道对方存在的撤销栈：
   * 不分派的话，答完一张语法点「上一个」撤掉的是**语法之前那个单词** —— 语法留下一次不该留的
   * 作答、单词丢掉一次该留的，一次误操作造两笔假数据，而按钮还亮着。
   */
  handleUndo() {
    if (this.data.mode === 'mixed' && !this.data.undoKinds.length) return;
    const kind = this.data.undoKinds[this.data.undoKinds.length - 1] || 'word';
    this.run('撤销上一张', async () => {
      if (kind && kind !== 'word') {
        await undoInterleave(kind);
        this.popUndo();
        this.showInterleave(nextOfKind(kind));
        await this.refreshHome();
        return '已恢复作答前状态';
      }
      const wasInterleaved = Boolean(this.data.interleave);
      const result = await undoAnswer({ mode: this.data.mode });
      if (!result.undone) return result.reason;
      if (wasInterleaved) rewindInterleave();
      // 插播是「刚才那个单词」带出来的：撤销那次作答，插播也不该被它提前用掉。
      this.showInterleave(null);
      this.popUndo();
      await this.refreshHome();
      return '已恢复作答前状态';
    });
  },

  /* ---------------- 混合模式的插播卡 ---------------- */

  showInterleave(interleave) {
    const question = interleave?.kind === 'kanji' ? interleave.card.question : null;
    const readings = question
      ? web.kanjiReadingUsage.shuffleKanjiReadingOptions(question.items.map(item => item.targetReading))
      : [];
    const pairs = {};
    const selectedWord = null;
    this.setData({
      interleave: interleave || null,
      interleaveRevealed: false,
      kanjiReadings: readings,
      kanjiPairs: pairs,
      selectedKanjiWord: selectedWord,
      ...kanjiMatchView(question, readings, pairs, selectedWord, false)
    });
  },

  revealInterleave() {
    bankReminder();
    if (this.data.interleave) {
      const question = this.data.interleave.kind === 'kanji' ? this.data.interleave.card.question : null;
      this.setData({
        interleaveRevealed: true,
        ...kanjiMatchView(question, this.data.kanjiReadings, this.data.kanjiPairs, this.data.selectedKanjiWord, true)
      });
      if (web.preferences.getStudyPreferences().zooSounds) web.sounds.playFlip();
    }
  },

  selectKanjiWord(event) {
    if (this.data.interleaveRevealed || !this.data.interleave?.card.question) return;
    const index = Number(event.currentTarget.dataset.index);
    const selectedWord = this.data.selectedKanjiWord === index ? null : index;
    this.setData({
      selectedKanjiWord: selectedWord,
      ...kanjiMatchView(this.data.interleave.card.question, this.data.kanjiReadings, this.data.kanjiPairs, selectedWord, false)
    });
  },

  selectKanjiReading(event) {
    if (this.data.interleaveRevealed || this.data.selectedKanjiWord === null) return;
    const readingIndex = Number(event.currentTarget.dataset.index);
    const pairs = web.kanjiReadingUsage.assignKanjiReadingPair(this.data.kanjiPairs, this.data.selectedKanjiWord, readingIndex);
    const selectedWord = null;
    this.setData({
      kanjiPairs: pairs,
      selectedKanjiWord: selectedWord,
      ...kanjiMatchView(this.data.interleave.card.question, this.data.kanjiReadings, pairs, selectedWord, false)
    });
  },

  answerInterleaveCard(event) {
    bankReminder();
    const answer = event.currentTarget.dataset.answer;
    const interleave = this.data.interleave;
    if (!interleave || !answer) return;
    const id = interleave.kind === 'grammar' ? interleave.card.id : interleave.kind === 'kanji' ? interleave.card.char : interleave.card.groupKey;
    this.run('记录作答', async () => {
      await answerInterleave(interleave.kind, id, answer);
      if (web.preferences.getStudyPreferences().zooSounds) {
        if (answer === 'know' || answer === 'known_forever') web.sounds.playKnow(this.correctStreak || 0);
        else web.sounds.playDontKnow();
      }
      this.correctStreak = answer === 'know' || answer === 'known_forever' ? (this.correctStreak || 0) + 1 : 0;
      this.pushUndo(interleave.kind);
      // 一张插播之后回单词；今天单词真做完时 refreshHome 再挑下一种卡。
      this.showInterleave(null);
      await this.refreshHome();
      return answer === 'forgot' ? '已安排稍后重学' : '已保存到本地库';
    });
  },

  handleLevelChange(event) {
    const levelIndex = Number(event.detail.value);
    const selectedLevel = this.data.levels[levelIndex] || '';
    this.setData({ selectedLevel, levelIndex });
    this.refreshHome();
  },

  handleDirectionChange(event) {
    const directionIndex = Number(event.detail.value);
    const direction = ['forward', 'reverse', 'kanji'][directionIndex] || 'forward';
    this.setData({ directionIndex, direction, mode: 'classic', modeLabel: '经典模式' });
    this.refreshHome();
  },

  handleNoteInput(event) {
    this.setData({ noteDraft: event.detail.value });
  },

  handleSaveNote() {
    const card = this.data.card;
    if (!card) return;
    this.run('保存笔记', async () => {
      await saveWordNote(card.id, this.data.noteDraft);
      return '已写入本地库';
    });
  },

});
