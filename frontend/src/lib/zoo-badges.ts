import type { ProgressOverview } from "./study-types";
import { computeStreak } from "./zoo-streak";

/**
 * 饲养员图鉴的徽章 —— 全部由本地真实进度算出,不存额外状态、不需要美术资源。
 * 纯函数,方便单测:给同一份进度必然得到同一批徽章。
 *
 * 四组:
 *   habitat  园区认证 —— 某个 JLPT 等级掌握度达标(和动物园地图的「丰容」阶段同一条线)
 *   streak   连续打卡
 *   words    累计掌握词数
 *   days     累计打卡天数(和连击不同:断了也不清零,奖励总量)
 */

export type BadgeGroup = "habitat" | "streak" | "words" | "days";

export interface Badge {
  id: string;
  group: BadgeGroup;
  emoji: string;
  title: string;
  /** 未解锁时显示的达成条件 */
  requirement: string;
  unlocked: boolean;
  /** 当前值 / 目标值,用于画进度条;园区类用百分比 */
  current: number;
  target: number;
}

/** 园区达到这个掌握度就算「饲养员认证」,与地图上的「热闹丰容」阶段同一条线 */
export const HABITAT_CERTIFY_PCT = 85;

const HABITATS = [
  { level: "N5", emoji: "🦫", name: "水豚温泉" },
  { level: "N4", emoji: "🐿️", name: "松鼠林" },
  { level: "N3", emoji: "🐦", name: "鸟舍" },
  { level: "N2", emoji: "🐼", name: "熊猫馆" },
  { level: "N1", emoji: "🦉", name: "夜行馆" }
] as const;

const STREAK_TIERS = [
  { days: 3, emoji: "🍊", title: "泡了三天" },
  { days: 7, emoji: "♨️", title: "一周不断汤" },
  { days: 30, emoji: "🌸", title: "一个月的常客" },
  { days: 100, emoji: "🏔️", title: "百日温泉客" }
];

const WORD_TIERS = [
  { count: 10, emoji: "🌱", title: "第一把松子" },
  { count: 100, emoji: "🌰", title: "百粒松子" },
  { count: 500, emoji: "🪵", title: "松子仓库" },
  { count: 1000, emoji: "🌳", title: "千粒松子树" },
  { count: 5000, emoji: "🏞️", title: "整片松子林" }
];

const DAY_TIERS = [
  { days: 10, emoji: "📅", title: "来过十天" },
  { days: 50, emoji: "🗓️", title: "来过五十天" },
  { days: 200, emoji: "🎖️", title: "两百天的老饲养员" }
];

export interface BadgeInput {
  overview: ProgressOverview;
  /** 打卡日期列表(WordStats.checkins) */
  checkins: string[];
  /** 当前学习日(WordStats.studyDate) */
  studyDate: string;
}

export function computeBadges({ overview, checkins, studyDate }: BadgeInput): Badge[] {
  const streak = computeStreak(checkins, studyDate);
  const checkinDays = new Set(checkins).size;
  // 「松子」数的是学过的词。以前取 completed(当时等于 known_forever),
  // 于是只有手动点过「熟知」的才算数,学了两千词的人卡在「百粒松子」。
  const knownWords = overview.words.seen;

  const habitat: Badge[] = HABITATS.map((item) => {
    const row = overview.wordsByLevel.find((level) => level.level === item.level);
    const total = row?.total ?? 0;
    // 认证看学过的覆盖率,和地图/柱状图同一条线。按 180 天掌握口径算的话
    // 五个园区永远认证不了,徽章系统等于废掉。
    const pct = total > 0 ? Math.round(((row?.seen ?? 0) / total) * 100) : 0;
    return {
      id: `habitat-${item.level}`,
      group: "habitat" as const,
      emoji: item.emoji,
      title: `${item.name}饲养员`,
      requirement: `${item.level} 掌握度 ${HABITAT_CERTIFY_PCT}%`,
      unlocked: pct >= HABITAT_CERTIFY_PCT,
      current: pct,
      target: HABITAT_CERTIFY_PCT
    };
  });

  const streakBadges: Badge[] = STREAK_TIERS.map((tier) => ({
    id: `streak-${tier.days}`,
    group: "streak" as const,
    emoji: tier.emoji,
    title: tier.title,
    requirement: `连续打卡 ${tier.days} 天`,
    unlocked: streak >= tier.days,
    current: Math.min(streak, tier.days),
    target: tier.days
  }));

  const wordBadges: Badge[] = WORD_TIERS.map((tier) => ({
    id: `words-${tier.count}`,
    group: "words" as const,
    emoji: tier.emoji,
    title: tier.title,
    requirement: `永久掌握 ${tier.count} 个词`,
    unlocked: knownWords >= tier.count,
    current: Math.min(knownWords, tier.count),
    target: tier.count
  }));

  const dayBadges: Badge[] = DAY_TIERS.map((tier) => ({
    id: `days-${tier.days}`,
    group: "days" as const,
    emoji: tier.emoji,
    title: tier.title,
    requirement: `累计打卡 ${tier.days} 天`,
    unlocked: checkinDays >= tier.days,
    current: Math.min(checkinDays, tier.days),
    target: tier.days
  }));

  return [...habitat, ...streakBadges, ...wordBadges, ...dayBadges];
}

export const GROUP_LABELS: Record<BadgeGroup, string> = {
  habitat: "园区认证",
  streak: "连续打卡",
  words: "松子收成",
  days: "来过的日子"
};
