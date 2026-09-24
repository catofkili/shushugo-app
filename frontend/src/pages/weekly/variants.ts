import type { WeekWindow, WeeklyReport } from "../../lib/analytics/weekly";
import { weeklyChapters } from "../WeeklyReportStory";

/**
 * 周报的三套版式。garden = V3「字间小院」；stars / film 是 2026-09-24 按用户要求并排做的两份新稿
 * （「重特效重动效、学网易云年度报告的风格不变，再做两份更好的」）。三份共用同一份 WeeklyReport 数据、
 * 同一套翻页 / 手势 / 分享外壳（WeeklyReportPage），只换场景。用户选定之后删掉另外两份。
 *
 * 选择记在 localStorage：这是「这台设备上看哪一版」的偏好，不是学习数据，不进同步。
 */
export type WeeklyVariant = "stars" | "film" | "garden";

export const WEEKLY_VARIANTS: { id: WeeklyVariant; label: string }[] = [
  { id: "stars", label: "星图" },
  { id: "film", label: "放映厅" },
  { id: "garden", label: "字间小院" }
];

const VARIANT_KEY = "mn-weekly-report-variant";

export const loadWeeklyVariant = (): WeeklyVariant => {
  try {
    const saved = localStorage.getItem(VARIANT_KEY);
    if (WEEKLY_VARIANTS.some((item) => item.id === saved)) return saved as WeeklyVariant;
  } catch { /* 隐私模式读不到就用默认 */ }
  return "stars";
};

export const saveWeeklyVariant = (variant: WeeklyVariant) => {
  try { localStorage.setItem(VARIANT_KEY, variant); } catch { /* 存不下就只在本次生效 */ }
};

/** 新版多一页「本周的你」（关键词单独揭晓，网易云年度报告最出片的那一页）；其余章节和 V3 同一套判据。 */
export const chaptersFor = (variant: WeeklyVariant, report: WeeklyReport | null) => {
  if (variant === "garden") return weeklyChapters(report);
  return [
    { id: "cover", label: variant === "film" ? "片头" : "这一周的星空" },
    { id: "effort", label: variant === "film" ? "片长" : "时间" },
    { id: "content", label: variant === "film" ? "新面孔" : "新星" },
    ...(report?.keyword ? [{ id: "keyword", label: "本周的你" }] : []),
    ...(report?.highlight ? [{ id: "highlight", label: variant === "film" ? "高光镜头" : "流星" }] : []),
    ...(report?.revisitWords.length ? [{ id: "revisit", label: variant === "film" ? "再拍一条" : "暗星" }] : []),
    { id: "end", label: variant === "film" ? "片尾" : "晚安" }
  ];
};

/**
 * 关键词说的是什么。每一句都对着 weekly.ts 的 getKeywordCandidates 判据写，
 * 改了判据要回来改这里 —— 这句话会被截图发出去，说错了比不说糟。
 */
export const KEYWORD_NOTES: Record<string, string> = {
  夜行者: "这一周，你最常在深夜十点以后学",
  早起鸟: "这一周，你最常在早上八点以前学",
  通勤党: "三成以上的练习，发生在早晚通勤的时间",
  周末突击手: "四成以上的练习，集中在周末",
  铁人: "已经连续学了两周以上，一天没断",
  匀速前进: "每天的新词量都很平稳，不紧不慢",
  单日爆发: "有一天的新词，是平时的三倍以上",
  复习派: "复习的次数比新词多，稳稳地往下扎根",
  开荒者: "新词比复习还多，一直在往前开路",
  攻坚手: "有词这一周被你反复练了五次以上"
};

export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
/** 周期是周日 14:00 到下周日 14:00，尾日取 endAt 那天（下周日，同 weekly-reports 的 windowEndDate），不是 window.end（周六） */
export const dottedRange = (window: WeekWindow) => {
  const boundary = new Date(window.endAt);
  const end = `${boundary.getFullYear()}-${String(boundary.getMonth() + 1).padStart(2, "0")}-${String(boundary.getDate()).padStart(2, "0")}`;
  return `${window.start.slice(0, 4)}.${window.start.slice(5, 7)}.${window.start.slice(8, 10)} — ${end.slice(5, 7)}.${end.slice(8, 10)}`;
};
