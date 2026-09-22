// data/kanji_reading_unit_runtime.json（558 KiB）：网页是 import() 懒加载；小程序里
// kanji-unit-index 的 loadKanjiUnitIndex 会 import 到这里，这里去分包拿。
module.exports = new Proxy({}, {
  get(_target, prop) {
    const stores = require('../shared/content-store');
    if (prop === '__esModule') return false;
    if (prop === 'then') return undefined;
    if (!stores.kanjiUnitRuntime) throw new Error('汉字单元索引还没从分包加载：先 await content.ready()');
    return prop === 'default' ? stores.kanjiUnitRuntime : stores.kanjiUnitRuntime[prop];
  }
});
