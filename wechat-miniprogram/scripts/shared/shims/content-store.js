// 出厂内容数据不进主包：这几份由 src/shared/content.js 用 require.async 从分包灌进来。
// 灌入前仅允许保留模块初始化引用；消费未就绪内容抛错，灌入后和网页完全一致。
module.exports = { questionMeanings: null, distinctionReviews: null, kanjiUnitRuntime: null, kanjiReadingUsage: null, pitchAccent: null, kanjiVariants: null, kanjiReadings: null, grammarKeyPoints: null };
