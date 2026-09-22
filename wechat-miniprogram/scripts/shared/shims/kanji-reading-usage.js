// data/kanji_reading_usage.json（346 KiB）：网页 import() 懒加载；这里去分包拿（同 kanji-unit-runtime）。
module.exports = new Proxy({}, {
  get(_target, prop) {
    const stores = require('../shared/content-store');
    if (prop === '__esModule') return false;
    if (prop === 'then') return undefined;
    if (!stores.kanjiReadingUsage) throw new Error('一字多音说明表还没从分包加载：先 await content.ready()');
    return prop === 'default' ? stores.kanjiReadingUsage : stores.kanjiReadingUsage[prop];
  }
});
