import { getWeekWindow, windowDays, type WeeklyReport } from "../../lib/analytics/weekly";

/**
 * 开发预览用的模拟周报：**只在 dev 构建、而且一份真实周报都没有的时候**顶上（WeeklyReportPage.reload）。
 * 为的是在 5199 这种空库预览里也能看周报、试分享（周报要有上一周的作答才生成，空库永远是空页）。
 *
 * ⚠️ 不写库、不标已读、不记埋点、不给「再练这个词」入口（词 id 是假的）。页面顶栏会挂一枚「模拟数据」。
 * 生产构建里这个模块只在 `import.meta.env.DEV` 分支里动态 import，会被整段裁掉。
 */
export const mockWeeklyReport = (): WeeklyReport => {
  const window = getWeekWindow(new Date(), 0);
  const reviews = [420, 512, 388, 1021, 655, 297, 734];
  const newWords = [22, 30, 18, 41, 25, 12, 28];
  const seconds = [2460, 3120, 2280, 5400, 3660, 1620, 4020];
  const daily = windowDays(window).map((date, i) => ({ date, reviews: reviews[i], newWords: newWords[i], seconds: seconds[i] }));
  const totalReviews = reviews.reduce((a, b) => a + b, 0);
  const totalSeconds = seconds.reduce((a, b) => a + b, 0);
  const newTotal = newWords.reduce((a, b) => a + b, 0);
  const metrics = {
    window, days: 7, minutes: Math.round(totalSeconds / 60), totalSeconds, totalReviews,
    wordReviews: 3310, grammarReviews: 612, kanjiReviews: 105, newWords: newTotal, reviewCount: totalReviews - newTotal,
    daily, streak: 23, cumulativeDays: 68, cumulativeWords: 1843
  };
  const words = ["我慢", "落ち着く", "何かと", "つかむ", "ばらばら", "受け取る", "間に合う", "どれだけ"];
  return {
    window,
    metrics,
    keyword: { keyword: "夜行者", rarity: 3 },
    keywordCandidates: [{ keyword: "夜行者", rarity: 3 }, { keyword: "复习派", rarity: 2 }, { keyword: "攻坚手", rarity: 3 }],
    speedBand: null,
    eta: null,
    references: [],
    highlight: { date: daily[3].date, text: `${daily[3].date} 完成了 ${reviews[3]} 次学习记录` },
    revisitWords: words.map((text, i) => ({ wordId: -(i + 1), text, count: [6, 5, 4, 4, 3, 3, 2, 2][i] }))
  };
};
