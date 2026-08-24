const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const { studySummary } = require('../../core/analytics');
const { achievementBoard } = require('../../runtime/achievements');

Page({
  data: { ready: false, summary: null, board: null, error: '' },
  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true, summary: studySummary(getDatabase()), board: achievementBoard() });
    } catch (error) { this.setData({ error: error?.message || String(error) }); }
  }
});
