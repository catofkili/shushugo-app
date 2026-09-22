const usage = require('../data/kanji-reading-usage');
const LEVELS = ['N5','N4','N3','N2','N1','未分级'];
Page({
  data: { query: '', version: '', total: 0, entries: [], selected: null },
  async onLoad() { await usage.loadKanjiReadingUsage(); this.showList(); },
  showList(query = '') {
    const all = usage.allKanjiReadingUsage();
    const entries = all.filter((entry) => !query || entry.char.includes(query)).slice(0, query ? 80 : 48).map((entry) => ({ char: entry.char, line: usage.readingLine(entry) }));
    this.setData({ query, version: usage.kanjiReadingUsageVersion(), total: all.length, entries, selected: query.length === 1 ? this.format(usage.kanjiReadingUsageFor(query)) : null });
  },
  format(entry) { return entry ? { ...entry, level: LEVELS[entry.levelRank] || '未分级', readings: entry.readings.map((reading) => ({ ...reading, kindText: reading.kinds.map((kind) => kind === 'on' ? '音读' : '训读').join(' · '), description: usage.clauseText(reading), examples: reading.examples.slice(0, 6) })) } : null; },
  search(event) { this.showList(String(event.detail.value || '').trim().slice(0, 8)); },
  select(event) { this.setData({ selected: this.format(usage.kanjiReadingUsageFor(event.currentTarget.dataset.char)) }); }
});
