// data/confusion_distinction_reviews.ts（336 KiB，数据 + 函数一体）编在 features 分包里，
// 这里是转发壳：没灌入时返回空，灌入后就是网页那份。
const stores = require('../shared/content-store');
const real = () => stores.distinctionReviews;
module.exports = {
  get DISTINCTION_REVIEWS() { return real() ? real().DISTINCTION_REVIEWS : []; },
  get distinctionReviewMap() { return real() ? real().distinctionReviewMap : new Map(); },
  distinctionReviewFor: (groupKey) => (real() ? real().distinctionReviewFor(groupKey) : null),
  distinctionNotesFor: (...args) => (real() ? real().distinctionNotesFor(...args) : [])
};
