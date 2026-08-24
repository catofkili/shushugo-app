const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const { achievementBoard } = require('../../runtime/achievements');

Page({
  data: { ready: false, board: null, categoryIndex: 0, categories: ['全部', '起步', '里程碑', '毅力', '手感', '翻车', '怪癖', '深挖'], rows: [], error: '' },
  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      const board = achievementBoard();
      this.setData({ ready: true, board, rows: board.items });
    } catch (error) { this.setData({ error: error?.message || String(error) }); }
  },
  handleCategoryChange(event) {
    const categoryIndex = Number(event.detail.value); const category = this.data.categories[categoryIndex];
    this.setData({ categoryIndex, rows: category === '全部' ? this.data.board.items : this.data.board.items.filter((item) => item.category === category) });
  }
});
