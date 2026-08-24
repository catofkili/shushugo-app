const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const { saveWordNote } = require('../../runtime/learning');
const {
  DEFAULT_FILTERS,
  MEMORY_BANDS,
  POS_BUCKETS,
  queryWordLibrary,
  tallyWordLibrary,
  wordLibraryDetail,
  wordLibraryIds,
  toggleWordFavorite,
  setWordsKnownForever
} = require('../../runtime/word-library');

const LEVEL_OPTIONS = [
  { id: 'all', label: '全部等级' },
  { id: 'N5', label: 'N5' },
  { id: 'N4', label: 'N4' },
  { id: 'N3', label: 'N3' },
  { id: 'N2', label: 'N2' },
  { id: 'N1', label: 'N1' },
  { id: 'unranked', label: '未分级' }
];
const BAND_OPTIONS = [
  { id: 'all', label: '全部色阶' },
  { id: 'due', label: '该复习' },
  { id: 'leech', label: '顽固词' },
  ...MEMORY_BANDS
];
const SORT_OPTIONS = [
  { id: 'level', label: '按等级' },
  { id: 'weakest', label: '最弱在前' },
  { id: 'recent', label: '最近学过' },
  { id: 'kana', label: '五十音' }
];

const formatError = (error) => error?.message || error?.errMsg || String(error);

Page({
  data: {
    ready: false,
    busy: false,
    error: '',
    query: '',
    levelIndex: 0,
    bandIndex: 0,
    posIndex: 0,
    sortIndex: 0,
    levelOptions: LEVEL_OPTIONS,
    bandOptions: BAND_OPTIONS,
    posOptions: [{ id: 'all', label: '全部词性' }, ...POS_BUCKETS],
    sortOptions: SORT_OPTIONS,
    filters: { ...DEFAULT_FILTERS },
    rows: [],
    summary: { total: 0, bands: {}, due: 0, leech: 0 },
    offset: 0,
    hasMore: false,
    selectedIds: [],
    selectionMode: false,
    detail: null,
    noteDraft: ''
  },

  async onLoad(options = {}) {
    const initialLevel = LEVEL_OPTIONS.findIndex((item) => item.id === options.level);
    if (initialLevel > 0) {
      this.setData({
        levelIndex: initialLevel,
        filters: { ...DEFAULT_FILTERS, level: LEVEL_OPTIONS[initialLevel].id }
      });
    }
    if (!getStatus().ready) {
      this.setData({ busy: true });
      try {
        await ensureDatabase();
      } catch (error) {
        this.setData({ error: formatError(error) });
      } finally {
        this.setData({ busy: false });
      }
    }
    this.setData({ ready: getStatus().ready });
    if (getStatus().ready) this.refreshRows();
  },

  onShow() {
    if (getStatus().ready && this.data.filters) this.refreshRows();
  },

  handleInput(event) {
    this.setData({ query: event.detail.value });
  },

  handleSearch() {
    this.patchFilters({ search: String(this.data.query || '').trim() });
  },

  handleLevelChange(event) {
    const index = Number(event.detail.value);
    this.setData({ levelIndex: index });
    this.patchFilters({ level: LEVEL_OPTIONS[index]?.id || 'all' });
  },

  handleBandChange(event) {
    const index = Number(event.detail.value);
    this.setData({ bandIndex: index });
    this.patchFilters({ band: BAND_OPTIONS[index]?.id || 'all' });
  },

  handlePosChange(event) {
    const index = Number(event.detail.value);
    this.setData({ posIndex: index });
    this.patchFilters({ pos: this.data.posOptions[index]?.id || 'all' });
  },

  handleSortChange(event) {
    const index = Number(event.detail.value);
    this.setData({ sortIndex: index });
    this.patchFilters({ sort: SORT_OPTIONS[index]?.id || 'level' });
  },

  patchFilters(patch) {
    const filters = { ...this.data.filters, ...patch };
    this.setData({ filters, offset: 0, rows: [], hasMore: false, selectedIds: [], selectionMode: false });
    this.refreshRows(filters);
  },

  refreshRows(filters = this.data.filters) {
    try {
      const rows = queryWordLibrary(filters, 0, 50);
      const selected = new Set(this.data.selectedIds || []);
      this.setData({
        rows: rows.map((row) => ({ ...row, selected: selected.has(row.id) })),
        offset: rows.length,
        hasMore: rows.length === 50,
        summary: tallyWordLibrary(filters),
        error: ''
      });
    } catch (error) {
      this.setData({ error: formatError(error) });
    }
  },

  handleLoadMore() {
    if (!this.data.hasMore || this.data.busy) return;
    try {
      const more = queryWordLibrary(this.data.filters, this.data.offset, 50);
      const selected = new Set(this.data.selectedIds || []);
      this.setData({
        rows: [...this.data.rows, ...more.map((row) => ({ ...row, selected: selected.has(row.id) }))],
        offset: this.data.offset + more.length,
        hasMore: more.length === 50
      });
    } catch (error) {
      this.setData({ error: formatError(error) });
    }
  },

  handleRowTap(event) {
    const id = Number(event.currentTarget.dataset.id);
    if (!id) return;
    if (this.data.selectionMode) return this.toggleSelection(id);
    try {
      const detail = wordLibraryDetail(id);
      this.setData({ detail, noteDraft: detail?.note || '' });
    } catch (error) {
      this.setData({ error: formatError(error) });
    }
  },

  toggleSelection(id) {
    const current = new Set(this.data.selectedIds || []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    const selectedIds = [...current];
    this.setData({
      selectedIds,
      selectionMode: selectedIds.length > 0,
      rows: this.data.rows.map((row) => ({ ...row, selected: current.has(row.id) }))
    });
  },

  handleLongPress(event) {
    const id = Number(event.currentTarget.dataset.id);
    if (id) this.setData({ selectionMode: true });
    if (id) this.toggleSelection(id);
  },

  handleSelect(event) {
    const id = Number(event.currentTarget.dataset.id);
    if (id) this.toggleSelection(id);
  },

  handleSelectVisible() {
    const ids = this.data.rows.map((row) => Number(row.id));
    const selectedIds = [...new Set([...(this.data.selectedIds || []), ...ids])];
    this.setData({
      selectedIds,
      selectionMode: selectedIds.length > 0,
      rows: this.data.rows.map((row) => ({ ...row, selected: true }))
    });
  },

  handleSelectAllFiltered() {
    try {
      const selectedIds = wordLibraryIds(this.data.filters, 300);
      this.setData({ selectedIds, selectionMode: selectedIds.length > 0, rows: this.data.rows.map((row) => ({ ...row, selected: selectedIds.includes(row.id) })) });
      wx.showToast({ title: `已选 ${selectedIds.length} 条`, icon: 'none' });
    } catch (error) {
      this.setData({ error: formatError(error) });
    }
  },

  handleClearSelection() {
    this.setData({ selectedIds: [], selectionMode: false, rows: this.data.rows.map((row) => ({ ...row, selected: false })) });
  },

  run(label, task) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    Promise.resolve().then(task).then((result) => {
      wx.showToast({ title: result || `${label}完成`, icon: 'none' });
      this.refreshRows();
      if (this.data.detail) this.setData({ detail: wordLibraryDetail(this.data.detail.id) });
    }).catch((error) => {
      this.setData({ error: `${label}失败：${formatError(error)}` });
    }).finally(() => this.setData({ busy: false }));
  },

  handleBatchKnown() {
    const ids = this.data.selectedIds;
    if (!ids.length) return;
    this.run('批量标记熟知', async () => {
      const result = await setWordsKnownForever(ids, true);
      this.handleClearSelection();
      return `已标记 ${result.count} 条熟知`;
    });
  },

  handleBatchUnmark() {
    const ids = this.data.selectedIds;
    if (!ids.length) return;
    this.run('批量取消熟知', async () => {
      const result = await setWordsKnownForever(ids, false);
      this.handleClearSelection();
      return `已恢复 ${result.count} 条`;
    });
  },

  handleFavorite() {
    if (!this.data.detail) return;
    const id = this.data.detail.id;
    this.run('收藏', async () => {
      const active = await toggleWordFavorite(id);
      this.setData({ detail: { ...this.data.detail, isFavorite: active, favorite: active } });
      return active ? '已收藏' : '已取消收藏';
    });
  },

  handleNoteInput(event) {
    this.setData({ noteDraft: event.detail.value });
  },

  handleSaveNote() {
    if (!this.data.detail) return;
    const id = this.data.detail.id;
    this.run('保存笔记', async () => {
      await saveWordNote(id, this.data.noteDraft);
      this.setData({ detail: { ...this.data.detail, note: this.data.noteDraft } });
      return '笔记已写入本地库';
    });
  },

  closeDetail() {
    this.setData({ detail: null, noteDraft: '' });
  },

  handleDetailKnown() {
    if (!this.data.detail) return;
    const id = this.data.detail.id;
    this.run('标记熟知', async () => {
      await setWordsKnownForever([id], true);
      this.setData({ detail: wordLibraryDetail(id) });
      return '已标记熟知';
    });
  },

  noop() {
  }
});
