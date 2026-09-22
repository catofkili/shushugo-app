// models/question-meaning-overrides.ts：网页在模块初始化时把 1 MB 的 JSON 建成 Map；
// 小程序改成按需读 content-store，灌入前返回 undefined（= 没有人工题面，走同一套清洗逻辑）。
const stores = require('../shared/content-store');
const pairKey = (kanji, kana) => `${kanji}\u0000${kana}`;
let map = null;
let source = null;
const ensure = () => {
  if (source === stores.questionMeanings) return map;
  source = stores.questionMeanings;
  map = source ? new Map(source.map((entry) => [pairKey(entry.kanji, entry.kana), entry.questionMeaning])) : null;
  return map;
};
module.exports = {
  reviewedQuestionMeaning: (kanji, kana) => (ensure() ? ensure().get(pairKey(kanji, kana)) : undefined),
  reviewedQuestionMeaningEntries: () => stores.questionMeanings || []
};
