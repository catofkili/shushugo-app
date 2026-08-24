const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const { TYPE_META, TYPE_ORDER, queryConfusionGroups, confusionSummary, setConfusionMastered } = require('../../runtime/confusion');

Page({
  data: {
    ready: false, busy: false, error: '', query: '', typeIndex: 0,
    typeOptions: [{ id: '', label: '全部类型' }, ...TYPE_ORDER.map((id) => ({ id, label: TYPE_META[id].name }))],
    rows: [], summary: { total: 0, mastered: 0 }, offset: 0, hasMore: false
  },

  async onLoad() {
    if (!getStatus().ready) {
      this.setData({ busy: true });
      try { await ensureDatabase(); } catch (error) { this.setData({ error: error?.message || String(error) }); }
      this.setData({ busy: false });
    }
    this.setData({ ready: getStatus().ready });
    if (getStatus().ready) this.refresh();
  },

  handleInput(event) { this.setData({ query: event.detail.value }); },
  handleSearch() { this.refresh(); },
  handleTypeChange(event) {
    const typeIndex = Number(event.detail.value);
    this.setData({ typeIndex });
    this.refresh({ typeIndex });
  },

  refresh(overrides = {}) {
    try {
      const typeIndex = overrides.typeIndex ?? this.data.typeIndex;
      const type = this.data.typeOptions[typeIndex]?.id || '';
      const rows = queryConfusionGroups(this.data.query, type, 0, 40);
      this.setData({ rows, offset: rows.length, hasMore: rows.length === 40, summary: confusionSummary(), error: '' });
    } catch (error) { this.setData({ error: error?.message || String(error) }); }
  },

  handleLoadMore() {
    const type = this.data.typeOptions[this.data.typeIndex]?.id || '';
    try {
      const more = queryConfusionGroups(this.data.query, type, this.data.offset, 40);
      this.setData({ rows: [...this.data.rows, ...more], offset: this.data.offset + more.length, hasMore: more.length === 40 });
    } catch (error) { this.setData({ error: error?.message || String(error) }); }
  },

  handleMastered(event) {
    const key = String(event.currentTarget.dataset.key || '');
    const current = event.currentTarget.dataset.mastered;
    const mastered = !(current === true || current === 'true' || Number(current) === 1);
    if (!key || this.data.busy) return;
    this.setData({ busy: true });
    setConfusionMastered(key, mastered)
      .then(() => this.refresh())
      .catch((error) => this.setData({ error: error?.message || String(error) }))
      .finally(() => this.setData({ busy: false }));
  }
});
