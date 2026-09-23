// 出厂内容数据不进主包：这几份由 src/shared/content.js 用 require.async 从分包灌进来。
// 灌入前各自退化（题面退回 words.meaning 的清洗结果、辨析注记为空、汉字单元索引抛错），
// 灌入后和网页完全一致。
module.exports = { questionMeanings: null, distinctionReviews: null, kanjiUnitRuntime: null, kanjiReadingUsage: null, pitchAccent: null, kanjiVariants: null, kanjiReadings: null, grammarKeyPoints: null };
