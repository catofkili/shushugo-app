const {
  ensureDatabase,
  getStatus
} = require('../../runtime/database-store');
const {
  answerCard,
  getStudyHome,
  saveWordNote,
  undoAnswer
} = require('../../runtime/learning');
const { playWordAudio } = require('../../runtime/audio');
const { confusionGroupsForWordWithDb } = require('../../runtime/confusion');

function formatError(error) {
  return error?.message || error?.errMsg || String(error);
}

Page({
  data: {
    busy: false,
    result: '',
    status: { ready: false },
    statusText: '等待初始化',
    detailText: '词库会下载到小程序自己的用户目录。',
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
    modeLabel: '经典模式'
  },

  onLoad(options = {}) {
    const mode = ['quick', 'mistakes'].includes(options.mode) ? options.mode : 'classic';
    const direction = ['forward', 'reverse', 'kanji'].includes(options.direction) ? options.direction : 'forward';
    const directionIndex = ['forward', 'reverse', 'kanji'].indexOf(direction);
    this.setData({
      mode,
      modeLabel: mode === 'quick' ? '快速学习' : mode === 'mistakes' ? '错题本' : '经典模式',
      direction,
      directionIndex
    });
  },

  onShow() {
    this.refreshStatus();
    if (getStatus().ready) this.refreshHome();
  },

  refreshStatus() {
    const status = getStatus();
    this.setData({
      status,
      statusText: status.ready ? '离线库已就绪' : '等待初始化',
      detailText: status.ready
        ? `来源：${status.source}；库文件：${status.paths.dbPath}`
        : '首次初始化会把词库放入小程序自己的用户目录。'
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
        card: home.card ? { ...home.card, confusions: confusionGroupsForWordWithDb(getDatabase(), home.card.id) } : null,
        stats: home.stats,
        answerVisible: false,
        noteDraft: home.card?.note || ''
      });
    } catch (error) {
      console.error('[study] 刷新首页失败', error);
      this.setData({ result: `读取今日任务失败：${formatError(error)}` });
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
      this.setData({ result: `${label}失败：${formatError(error)}` });
      wx.showToast({ title: '操作失败，请看详情', icon: 'none', duration: 2600 });
    } finally {
      this.setData({ busy: false });
    }
  },

  handleInit() {
    this.run('初始化本地库', async () => {
      const db = await ensureDatabase();
      const row = db.exec('SELECT COUNT(*) FROM words')[0]?.values?.[0]?.[0] ?? 0;
      await this.refreshHome();
      return `words=${row}`;
    });
  },

  handleReveal() {
    if (this.data.card) this.setData({ answerVisible: true });
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
    const answer = event.currentTarget.dataset.answer;
    const card = this.data.card;
    if (!card || !answer) return;
    this.run('记录作答', async () => {
      await answerCard(card.id, answer, { direction: this.data.direction, mode: this.data.mode === 'classic' ? undefined : this.data.mode, relief: Boolean(card.relief) });
      await this.refreshHome();
      return card.relief ? '减负卡已看完（不改记忆数据）' : answer === 'forgot' ? '已安排稍后重学' : '已保存到本地库';
    });
  },

  handleUndo() {
    this.run('撤销上一张', async () => {
      const result = await undoAnswer();
      await this.refreshHome();
      return result.undone ? '已恢复作答前状态' : result.reason;
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
