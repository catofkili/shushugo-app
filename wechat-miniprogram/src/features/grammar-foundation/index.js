const foundation = require('../data/grammar-foundation');
Page({
  data: { sections: foundation.grammarFoundationSections, section: '', rules: [] },
  onLoad() { this.load(); },
  load() { this.setData({ rules: foundation.grammarFoundationRules.filter((rule) => !this.data.section || rule.section === this.data.section).map((rule) => ({ ...rule, tables: rule.tables || [], open: false })) }); },
  pickSection(event) { this.setData({ section: event.currentTarget.dataset.id }, () => this.load()); },
  toggle(event) { const id = event.currentTarget.dataset.id; this.setData({ rules: this.data.rules.map((rule) => ({ ...rule, open: rule.id === id ? !rule.open : rule.open })) }); }
});
