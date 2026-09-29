const { getDatabase, getStatus, restoreDatabase, saveDatabase } = require('../../runtime/database-store');
const { getStudyHome } = require('../../runtime/learning');
const { studySummary } = require('../../core/analytics');
const core = require('../../core/study-core');
const { web } = core;

const greetingFor = (hour) => {
  if (hour < 6) return '夜深了，少学一点也算数';
  if (hour < 11) return '早上好，今天也慢慢来';
  if (hour < 14) return '中午好，来收集一点';
  if (hour < 18) return '下午好，学一点就很好';
  return '晚上好，给今天收个尾';
};

Page({
  data: {
    ready: false,
    loading: true,
    greeting: '',
    stats: { planned: 0, completed: 0, remaining: 0, dueTotal: 0 },
    summary: { today: 0, week: 0, due: 0, streak: 0 },
    notice: '',
    skin: '',
    postExam: null,
    postExamTarget: '',
    postExamChoice: null,
    focusArmed: false
  },

  onLoad() {
    this.setData({ greeting: greetingFor(new Date().getHours()) });
  },

  async onShow() {
    await this.refresh();
  },

  async refresh() {
    this.setData({ loading: true, notice: '' });
    try {
      if (!getStatus().ready) await restoreDatabase();
      const [home, summary] = await Promise.all([
        getStudyHome(),
        Promise.resolve(studySummary(getDatabase()))
      ]);
      const postExam = core.withDb(getDatabase(), () => web.preferences.postExamRecovery());
      const postExamChoice = postExam ? core.withDb(getDatabase(), () => web.preferences.postExamChoice(postExam.key)) : null;
      const skin = require('../../core/study-core').getState(getDatabase(), 'yuzu_equipped:theme', '');
      const palettes = {
        'theme-matcha': { frontColor: '#000000', backgroundColor: '#E7F1D9' },
        'theme-sakura': { frontColor: '#000000', backgroundColor: '#F8E2E4' },
        'theme-night': { frontColor: '#ffffff', backgroundColor: '#362F2B' }
      };
      if (palettes[skin]) {
        wx.setNavigationBarColor(palettes[skin]);
        wx.setTabBarStyle({ backgroundColor: palettes[skin].backgroundColor, color: skin === 'theme-night' ? '#D7C8B5' : '#8A7764', selectedColor: skin === 'theme-night' ? '#F3C46B' : '#5F983A' });
      }
      this.setData({ ready: true, stats: home.stats, summary, skin, postExam, postExamTarget: postExam?.target || '', postExamChoice, postExamDays: web.preferences.POST_EXAM_LIGHT_DAYS, focusArmed: web.studyFocus.isStudyFocusArmed() });
    } catch (error) {
      console.info('[home] 本地词库尚未就绪', error);
      this.setData({ ready: false, notice: '首次使用先到「单词」下载离线词库。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openTab(event) {
    wx.switchTab({ url: event.currentTarget.dataset.url });
  },

  openPage(event) {
    wx.navigateTo({ url: event.currentTarget.dataset.url });
  },

  toggleStudyFocus() {
    if (this.data.focusArmed) {
      web.studyFocus.setStudyFocusArmed(false);
      this.setData({ focusArmed: false });
      return;
    }
    wx.showModal({
      title: '开启倒计时学习？',
      content: '进背词页就开始计时，每专注 10 分钟休息一次。每段至少背 10 个词，完成后点宝箱领柚子。离开背词页，本段额外奖励作废。每天奖励依次为 100、50、25、23、12、6、3、2、1。',
      confirmText: '开启倒计时',
      cancelText: '暂不',
      success: ({ confirm }) => {
        if (!confirm) return;
        web.studyFocus.setStudyFocusArmed(true);
        this.setData({ focusArmed: true });
      }
    });
  },

  async choosePostExam(event) {
    const { postExam } = this.data;
    if (!postExam) return;
    const choice = event.currentTarget.dataset.choice;
    if (choice !== 'light' && choice !== 'usual') return;
    const db = getDatabase();
    core.withDb(db, () => {
      web.preferences.choosePostExamIntensity(postExam.key, choice);
      if (choice === 'usual') {
        web.wordApi.refreshTodayWordPlan();
        web.mixedCards.refreshMixedCardTasks(db);
      }
    });
    await saveDatabase();
    await this.refresh();
  },

  async adjustPostExamGoal() {
    const { postExam } = this.data;
    if (postExam) {
      core.withDb(getDatabase(), () => web.preferences.choosePostExamIntensity(postExam.key, 'light'));
      await saveDatabase();
    }
    wx.navigateTo({ url: '/features/jlpt-plan/index' });
  }
});
