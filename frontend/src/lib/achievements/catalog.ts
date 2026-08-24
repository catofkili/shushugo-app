import type { AchievementStats } from "./stats";

export type AchievementTier = "common" | "rare" | "epic";
export type AchievementCategory = "起步" | "里程碑" | "毅力" | "手感" | "翻车" | "怪癖" | "深挖";

export interface Achievement {
  id: string;
  name: string;
  /** 解锁条件，直说。隐藏成就在没拿到之前不显示这一行。 */
  description: string;
  emoji: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** 达到这个数就解锁。1 = 有没有的布尔型，>1 的会画进度条 */
  goal: number;
  /** 隐藏成就：拿到之前只显示 ???，免得剧透，也免得有人对着刷 */
  hidden?: boolean;
  /** 当前进度值 */
  value: (stats: AchievementStats) => number;
}

/**
 * 成就清单。
 *
 * 三条自己定的规矩：
 *  1. **判据必须能从历史里算出来**，这样上线即追认 —— 没人愿意为了拿成就重新学一遍。
 *  2. **一半以上不能是「数够多少个」**。纯里程碑的成就等于把进度条切成段，
 *     Steam 上那些让人记住的都是「你干了件蠢事」或者「你居然试了这个」。
 *  3. **翻车成就不许羞辱人**。「先冷静」是递一杯水，不是记一笔账 —— 连着忘十个
 *     本来就该停下歇会儿，成就只是把这件事说出来。
 */
export const ACHIEVEMENTS: Achievement[] = [
  // ——— 起步 ———
  { id: "first-know", name: "开张", description: "答对第一个词", emoji: "🌱", category: "起步", tier: "common", goal: 1, value: (s) => s.totalKnow },
  { id: "first-note", name: "好记性不如烂笔头", description: "给某个词写下第一条便签", emoji: "📝", category: "起步", tier: "common", goal: 1, value: (s) => s.notes },
  { id: "first-confusion", name: "明察秋毫", description: "在疑难辨析里标掌握第一组", emoji: "🔍", category: "起步", tier: "common", goal: 1, value: (s) => s.confusionMastered },
  { id: "first-kanji", name: "认字", description: "开始汉字读音模式", emoji: "🈶", category: "起步", tier: "common", goal: 1, value: (s) => s.kanjiWords },
  { id: "first-reverse", name: "反过来", description: "用一次反向模式：看着中文写日语", emoji: "🔄", category: "起步", tier: "common", goal: 1, value: (s) => s.reverseReviews },

  // ——— 里程碑 ———
  { id: "words-100", name: "百词斩", description: "100 个词进入复习", emoji: "💯", category: "里程碑", tier: "common", goal: 100, value: (s) => s.distinctWords },
  { id: "words-1000", name: "千词斩", description: "1,000 个词进入复习", emoji: "🗡️", category: "里程碑", tier: "common", goal: 1000, value: (s) => s.distinctWords },
  { id: "words-3000", name: "三千院", description: "3,000 个词进入复习", emoji: "⛩️", category: "里程碑", tier: "rare", goal: 3000, value: (s) => s.distinctWords },
  { id: "reviews-10000", name: "一万次", description: "累计作答 10,000 次", emoji: "🔢", category: "里程碑", tier: "common", goal: 10000, value: (s) => s.totalReviews },
  { id: "reviews-50000", name: "五万次", description: "累计作答 50,000 次", emoji: "🏔️", category: "里程碑", tier: "epic", goal: 50000, value: (s) => s.totalReviews },
  { id: "mastered-10", name: "第一批毕业生", description: "10 个词的复习间隔拉到 180 天以上", emoji: "🎓", category: "里程碑", tier: "common", goal: 10, value: (s) => s.masteredWords },
  { id: "mastered-100", name: "退休名单", description: "100 个词的复习间隔拉到 180 天以上", emoji: "🏝️", category: "里程碑", tier: "rare", goal: 100, value: (s) => s.masteredWords },
  { id: "hours-100", name: "一百小时", description: "累计学习满 100 小时", emoji: "⏳", category: "里程碑", tier: "rare", goal: 6000, value: (s) => s.minutesTotal },
  { id: "one-year", name: "一周年", description: "从第一次学习那天起满 365 天", emoji: "🎂", category: "里程碑", tier: "rare", goal: 365, value: (s) => s.daysSinceFirst },

  // ——— 毅力 ———
  { id: "streak-7", name: "一周不断", description: "连续 7 天有学习记录", emoji: "📆", category: "毅力", tier: "common", goal: 7, value: (s) => s.longestDayStreak },
  { id: "streak-30", name: "满月", description: "连续 30 天有学习记录", emoji: "🌕", category: "毅力", tier: "rare", goal: 30, value: (s) => s.longestDayStreak },
  { id: "streak-100", name: "百日", description: "连续 100 天有学习记录", emoji: "🎏", category: "毅力", tier: "epic", goal: 100, value: (s) => s.longestDayStreak },
  { id: "comeback-7", name: "归队", description: "断了一周以上，又回来了", emoji: "🫡", category: "毅力", tier: "common", goal: 7, value: (s) => s.longestComebackGap },
  { id: "comeback-30", name: "久别重逢", description: "断了一个月以上，又回来了", emoji: "🕰️", category: "毅力", tier: "rare", hidden: true, goal: 30, value: (s) => s.longestComebackGap },
  { id: "five-minutes", name: "五分钟也是学", description: "有一天只学了不到五分钟 —— 但没断", emoji: "🕐", category: "毅力", tier: "common", goal: 1, value: (s) => (s.shortestStudyDayMinutes > 0 && s.shortestStudyDayMinutes < 5 ? 1 : 0) },
  { id: "day-1000", name: "一日千词", description: "单日作答 1,000 次", emoji: "🔥", category: "毅力", tier: "rare", goal: 1000, value: (s) => s.maxReviewsInDay },
  { id: "marathon", name: "马拉松", description: "单日学习时长满 8 小时", emoji: "🏃", category: "毅力", tier: "epic", goal: 480, value: (s) => s.maxMinutesInDay },

  // ——— 手感 ———
  { id: "know-streak-25", name: "顺风局", description: "连着答对 25 次", emoji: "📈", category: "手感", tier: "common", goal: 25, value: (s) => s.longestKnowStreak },
  { id: "know-streak-50", name: "一气呵成", description: "连着答对 50 次", emoji: "⚡", category: "手感", tier: "rare", goal: 50, value: (s) => s.longestKnowStreak },
  { id: "accuracy-90", name: "稳如老狗", description: "某天答满 100 次，正确率还有九成", emoji: "🎯", category: "手感", tier: "rare", goal: 90, value: (s) => Math.floor(s.bestDailyAccuracy * 100) },
  { id: "known-forever-20", name: "断舍离", description: "一天里点 20 次「熟知」，把词请出复习队列", emoji: "✂️", category: "手感", tier: "common", goal: 20, value: (s) => s.maxKnownForeverInDay },

  // ——— 翻车 ———
  { id: "forgot-streak-10", name: "先冷静", description: "连着点了 10 次「忘记」。喝口水，这不怪你", emoji: "🧊", category: "翻车", tier: "common", goal: 10, value: (s) => s.longestForgotStreak },
  { id: "forgot-streak-20", name: "再冷静一点", description: "连着点了 20 次「忘记」。真的，去睡吧", emoji: "🥶", category: "翻车", tier: "rare", goal: 20, value: (s) => s.longestForgotStreak },
  { id: "leech-1", name: "这词跟我有仇", description: "有一个词被你忘了整整 8 次", emoji: "😤", category: "翻车", tier: "common", goal: 1, value: (s) => s.leeches },
  { id: "leech-100", name: "仇人名单", description: "100 个词各被你忘了 8 次以上", emoji: "📜", category: "翻车", tier: "rare", goal: 100, value: (s) => s.leeches },
  { id: "relapse-forever", name: "我明明背过", description: "点过「熟知」的词，后来又忘了", emoji: "🫠", category: "翻车", tier: "common", goal: 1, value: (s) => s.relapsedForever },
  { id: "fuzzy-half", name: "假装在学", description: "某天答了 50 次以上，一半都点的「模糊」", emoji: "😶‍🌫️", category: "翻车", tier: "common", goal: 50, value: (s) => Math.floor(s.worstDailyFuzzyShare * 100) },
  { id: "thrice-a-day", name: "二进宫", description: "同一个词，在同一天里被你忘了三次", emoji: "🔁", category: "翻车", tier: "common", goal: 1, value: (s) => s.thriceForgotSameDay },
  { id: "backlog-500", name: "鸵鸟", description: "到期池积压到 500 个", emoji: "🙈", category: "翻车", tier: "common", goal: 500, value: (s) => s.dueBacklog },
  { id: "backlog-1000", name: "债台高筑", description: "到期池积压到 1,000 个", emoji: "🏦", category: "翻车", tier: "rare", goal: 1000, value: (s) => s.dueBacklog },
  { id: "ghosted", name: "失联", description: "整整两周没打开过 —— 现在回来了就不算数了", emoji: "👻", category: "翻车", tier: "common", hidden: true, goal: 14, value: (s) => s.longestComebackGap },

  // ——— 怪癖 ———
  { id: "night-100", name: "夜猫子", description: "半夜 0 点到 4 点之间答过 100 次", emoji: "🌙", category: "怪癖", tier: "common", goal: 100, value: (s) => s.nightReviews },
  { id: "night-1000", name: "与月亮为伴", description: "半夜 0 点到 4 点之间答过 1,000 次", emoji: "🌚", category: "怪癖", tier: "rare", goal: 1000, value: (s) => s.nightReviews },
  { id: "early-50", name: "早起的鸟", description: "早上 5 点到 8 点之间答过 50 次", emoji: "🐦", category: "怪癖", tier: "common", goal: 50, value: (s) => s.earlyReviews },
  { id: "day-and-night", name: "昼夜不分", description: "同一天里，凌晨三点和早上七点你都在答题", emoji: "🌗", category: "怪癖", tier: "epic", hidden: true, goal: 1, value: (s) => s.dayAndNight },
  { id: "burst", name: "手速", description: "同一秒里答掉了 5 张卡", emoji: "🖱️", category: "怪癖", tier: "common", hidden: true, goal: 5, value: (s) => s.sameSecondBurst },
  { id: "new-year", name: "元旦也学", description: "1 月 1 日那天你在背单词", emoji: "🎍", category: "怪癖", tier: "rare", hidden: true, goal: 1, value: (s) => s.studiedOnNewYear },
  { id: "leap-day", name: "闰日", description: "2 月 29 日那天你在背单词。下次机会四年后", emoji: "🐸", category: "怪癖", tier: "epic", hidden: true, goal: 1, value: (s) => s.studiedOnLeapDay },

  // ——— 深挖 ———
  { id: "notes-50", name: "笔记狂魔", description: "写下 50 条便签", emoji: "🗂️", category: "深挖", tier: "rare", goal: 50, value: (s) => s.notes },
  { id: "confusion-100", name: "辨析大师", description: "在疑难辨析里标掌握 100 组", emoji: "🧠", category: "深挖", tier: "rare", goal: 100, value: (s) => s.confusionMastered },
  { id: "favorites-50", name: "收藏家", description: "收藏 50 个词", emoji: "⭐", category: "深挖", tier: "common", goal: 50, value: (s) => s.favorites },
  { id: "all-three", name: "全家桶", description: "单词、汉字、语法三条线都开过", emoji: "🍱", category: "深挖", tier: "rare", goal: 3, value: (s) => (s.distinctWords > 0 ? 1 : 0) + (s.kanjiWords > 0 ? 1 : 0) + (s.grammarPoints > 0 ? 1 : 0) }
];

export const CATEGORY_ORDER: AchievementCategory[] = ["起步", "里程碑", "毅力", "手感", "翻车", "怪癖", "深挖"];

export const TIER_LABEL: Record<AchievementTier, string> = {
  common: "常规",
  rare: "稀有",
  epic: "史诗"
};
