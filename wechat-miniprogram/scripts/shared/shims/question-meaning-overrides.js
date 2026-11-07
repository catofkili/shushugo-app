// models/question-meaning-overrides.ts：网页在模块初始化时把 1 MB 的 JSON 建成 Map；
// 小程序改成按需读 content-store；灌入前抛错，不能静默改用未经审校的词义。
const stores = require('../shared/content-store');
const pairKey = (kanji, kana) => `${kanji}\u0000${kana}`;
let map = null;
let source = null;
const ensure = () => {
  if (!stores.questionMeanings) throw new Error('内容 questionMeanings 未 ready：先 await readyForRoute');
  if (source === stores.questionMeanings) return map;
  source = stores.questionMeanings;
  map = new Map(source.map((entry) => [pairKey(entry.kanji, entry.kana), entry.questionMeaning]));
  return map;
};
module.exports = {
  reviewedQuestionMeaning: (kanji, kana) => ensure().get(pairKey(kanji, kana)),
  reviewedQuestionMeaningEntries: () => { ensure(); return stores.questionMeanings; }
};
