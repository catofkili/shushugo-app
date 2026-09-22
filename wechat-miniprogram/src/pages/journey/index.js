const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const { studySummary } = require('../../core/analytics');
const { achievementBoard } = require('../../runtime/achievements');

Page({
  data: { ready: false, summary: null, board: null, error: '' },
  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      const board = achievementBoard();
      this.setData({ ready: true, summary: studySummary(getDatabase()), board: { unlocked: board.unlocked, total: board.total, items: board.items.filter((item) => item.unlocked).map(({ id, emoji, name }) => ({ id, emoji, name })) } });
    } catch (error) { console.error('[journey] 读取失败', error); this.setData({ error: '暂时无法读取，请稍后重试' }); }
  }
});
