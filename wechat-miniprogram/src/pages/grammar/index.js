const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const { grammarSummary, markGrammar, searchGrammar, toggleGrammarFavorite } = require('../../runtime/grammar');

Page({
  data: {
    ready: false,
    query: '',
    level: '',
    levelIndex: 0,
    levels: ['', 'N5', 'N4', 'N3', 'N2', 'N1'],
    rows: [],
    selected: null,
    summary: [],
    immersive: false,
    immersiveRows: [],
    immersiveIndex: 0,
    busy: false,
    error: ''
  },

  async onLoad() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true, summary: grammarSummary() });
      this.search();
    } catch (error) {
      this.setData({ error: error?.message || String(error) });
    }
  },

  handleInput(event) {
    this.setData({ query: event.detail.value });
    this.search();
  },

  handleLevelChange(event) {
    const levelIndex = Number(event.detail.value);
    this.setData({ levelIndex, level: this.data.levels[levelIndex] || '', selected: null });
    this.search();
  },

  search() {
    try {
      this.setData({ rows: searchGrammar(this.data.query, { level: this.data.level, limit: 100 }) });
    } catch (error) {
      this.setData({ error: error?.message || String(error) });
    }
  },

  open(event) {
    const id = Number(event.currentTarget.dataset.id);
    const selected = this.data.rows.find((row) => Number(row.id) === id);
    if (selected) this.setData({ selected });
  },

  async markKnown() {
    const selected = this.data.selected;
    if (!selected || this.data.busy) return;
    this.setData({ busy: true });
    try {
      await markGrammar(selected.id, true);
      this.setData({ selected: { ...selected, known_forever: 1, seen_count: Number(selected.seen_count || 0) + 1 } });
      this.search();
    } catch (error) {
      this.setData({ error: error?.message || String(error) });
    } finally {
      this.setData({ busy: false });
    }
  },

  async toggleFavorite() {
    const selected = this.data.selected;
    if (!selected || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const favorite = await toggleGrammarFavorite(selected.id);
      this.setData({ selected: { ...selected, favorite: favorite ? 1 : 0 } });
      this.search();
    } catch (error) {
      this.setData({ error: error?.message || String(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  handleImmersive() {
    if (this.data.immersive) return this.setData({ immersive: false });
    try {
      const rows = searchGrammar('', { level: this.data.level, limit: 200 }).filter((row) => row.example_jp);
      this.setData({ immersive: true, immersiveRows: rows, immersiveIndex: 0 });
    } catch (error) { this.setData({ error: error?.message || String(error) }); }
  },
  nextImmersive() {
    if (!this.data.immersiveRows.length) return;
    this.setData({ immersiveIndex: (this.data.immersiveIndex + 1) % this.data.immersiveRows.length });
  }
});
