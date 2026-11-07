// data/confusion_distinction_reviews.ts（336 KiB，数据 + 函数一体）编在 features 分包里，
// 这里是转发壳：消费前必须灌入，不能把「没加载」当成「没有可出题的组」。
const stores = require('../shared/content-store');
const real = () => {
  if (!stores.distinctionReviews) throw new Error('内容 distinctionReviews 未 ready：先 await readyForHomeMode / readyForRoute');
  return stores.distinctionReviews;
};
module.exports = {
  loadDistinctionReviews: () => require('../shared/content').load('distinctionReviews').then(() => undefined),
  distinctionReviewsLoaded: () => Boolean(stores.distinctionReviews),
  get DISTINCTION_REVIEWS() { return real().DISTINCTION_REVIEWS; },
  get distinctionReviewMap() { return real().distinctionReviewMap; },
  distinctionReviewFor: (groupKey) => real().distinctionReviewFor(groupKey),
  distinctionNotesFor: (...args) => real().distinctionNotesFor(...args)
};
