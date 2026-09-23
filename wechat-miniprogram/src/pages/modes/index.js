/*
 * 学习模式清单 = 网页的 STUDY_MODES（studyMode.ts），连说明文字和角标都取那一份。
 * ⚠️ 别再在这里手写一遍模式说明：以前这页写着「快速学习 = 独立的 12 张小队列」，
 * 而网页那边快速学习是「今日计划一页铺 50 张翻着看」—— 同一个入口两套说法。
 * 角标（每个模式现在还能练多少）也来自网页的 WordStats.modeCounts，不另算。
 */
const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const core = require('../../core/study-core');
const { cachedEntitlement } = require('../../runtime/entitlements');

const TONE_BY_MODE = { classic: 'blue', mixed: 'purple', mistakes: 'red', quick: 'green', reverse: 'purple', kanji: 'orange' };
// 六个模式全摆出来（混合学习的三种插播卡面 2026-09-23 接上了）。
const HIDDEN = new Set();

Page({
  data: { modes: [], ready: false, error: '' },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      const stats = core.wordStatsFor(getDatabase(), {});
      this.setData({
        ready: true,
        modes: core.web.studyMode.VISIBLE_STUDY_MODES.filter((mode) => !HIDDEN.has(mode.id)).map((mode) => ({
          id: mode.id,
          title: mode.title,
          subtitle: mode.subtitle,
          detail: mode.description,
          count: Number(stats.modeCounts[mode.id] || 0),
          tone: TONE_BY_MODE[mode.id] || 'blue'
        }))
      });
    } catch (error) {
      console.error('[modes] 读取失败', error);
      this.setData({ error: '暂时无法读取，请稍后重试' });
    }
  },

  startMode(event) {
    const mode = String(event.currentTarget.dataset.mode || 'classic');
    if (!core.web.studyMode.VISIBLE_STUDY_MODES.some((item) => item.id === mode)) return;
    if (mode === 'mixed' && !cachedEntitlement().active) {
      wx.showToast({ title: '完整计划需 Pro 或有效试用', icon: 'none' });
      return;
    }
    core.web.studyMode.saveStudyMode(mode);
    // 单词是 tab 页；navigateTo 不能打开 tab 页，switchTab 又不能带 query。
    getApp().globalData.pendingStudyMode = mode;
    wx.switchTab({ url: '/pages/index/index' });
  }
});
