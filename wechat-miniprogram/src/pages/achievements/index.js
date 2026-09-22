const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const { achievementBoard } = require('../../runtime/achievements');
const { web } = require('../../runtime/extended-features');

// 隐藏成就在拿到之前只显示 ???（同网页 AchievementsPage），免得剧透，也免得有人对着刷。
const toRow = (item) => ({
  id: item.id,
  emoji: item.hidden && !item.unlocked ? '❓' : item.emoji,
  name: item.hidden && !item.unlocked ? '???' : item.name,
  description: item.hidden && !item.unlocked ? '隐藏成就，拿到之后揭晓' : item.description,
  category: item.category,
  tier: web.achievements.TIER_LABEL[item.tier] || '',
  goal: item.goal,
  progress: item.progress,
  percent: item.goal ? Math.round(item.progress / item.goal * 100) : 0,
  unlocked: item.unlocked,
  unlockedOn: item.unlockedOn
});

Page({
  data: { ready: false, board: null, categoryIndex: 0, categories: ['全部', ...web.achievements.CATEGORY_ORDER], rows: [], error: '' },
  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      const board = achievementBoard();
      const rows = board.items.map(toRow);
      this.setData({ ready: true, board: { unlocked: board.unlocked, total: board.total, rows }, rows: this.filter(rows, this.data.categoryIndex) });
    } catch (error) { console.error('[achievements] 读取失败', error); this.setData({ error: '暂时无法读取，请稍后重试' }); }
  },
  filter(rows, categoryIndex) {
    const category = this.data.categories[categoryIndex];
    return category === '全部' ? rows : rows.filter((item) => item.category === category);
  },
  handleCategoryChange(event) {
    const categoryIndex = Number(event.detail.value);
    this.setData({ categoryIndex, rows: this.filter(this.data.board.rows, categoryIndex) });
  }
});
