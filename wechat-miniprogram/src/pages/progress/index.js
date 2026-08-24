const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const { studySummary } = require('../../core/analytics');

Page({
  data: { ready: false, summary: null, error: '' },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true, summary: studySummary(getDatabase()) });
    } catch (error) {
      this.setData({ error: error?.message || String(error) });
    }
  }
});
