const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const { studySummary } = require('../../core/analytics');

Page({
  data: { ready: false, summary: null, error: '' },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true, summary: studySummary(getDatabase()) });
    } catch (error) {
      console.error('[progress] 读取失败', error);
      this.setData({ error: '暂时无法读取，请稍后重试' });
    }
  }
});
