// 「继续学习」按钮的每日装扮:颜色按七曜换日本传统色,文案钩子分两层——
// 巧合钩子(日凑整/累计里程碑,条件苛刻、出现即彩蛋)优先,
// 常驻钩子(连击/星徽/限定色)按日期轮换兜底。纯函数,方便测试。

export interface EncoreDayColor {
  weekdayJp: string;
  colorName: string;
  /** 按钮底色 */
  hex: string;
  /** 按钮上的文字色(同色系深色) */
  ink: string;
}

/** 七曜 × 日本传统色,周期固定,顺带教曜日单词 */
export const ENCORE_DAY_COLORS: EncoreDayColor[] = [
  { weekdayJp: "日曜日", colorName: "珊瑚", hex: "#F0908D", ink: "#4C1A18" },
  { weekdayJp: "月曜日", colorName: "藤色", hex: "#BBA8E0", ink: "#2E2352" },
  { weekdayJp: "火曜日", colorName: "紅緋", hex: "#F39A8C", ink: "#521710" },
  { weekdayJp: "水曜日", colorName: "浅葱", hex: "#5FC3CE", ink: "#0C3A3F" },
  { weekdayJp: "木曜日", colorName: "若竹", hex: "#7FD0A0", ink: "#123A24" },
  { weekdayJp: "金曜日", colorName: "山吹", hex: "#F5C15C", ink: "#4A3407" },
  { weekdayJp: "土曜日", colorName: "桔梗", hex: "#9D97DE", ink: "#26215C" }
];

export const encoreDayColor = (studyDate: string): EncoreDayColor =>
  ENCORE_DAY_COLORS[new Date(`${studyDate}T00:00:00`).getDay()];

export interface EncoreHookInput {
  studyDate: string;
  todayWordCount: number;
  weekEncoreCount: number;
  /** 推荐加餐量(积压递减批或强度的一半),巧合钩子的「顺手」阈值 */
  recommendedSize: number;
  /** 累计学过的词数,里程碑钩子用 */
  totalLearned: number;
}

export interface EncoreHook {
  kind: "milestone" | "round" | "streak" | "badge" | "color";
  /** 按钮上方的钩子文案(不含数量与用时,由调用方拼接) */
  lead: string;
  /** 巧合钩子会连数量一起改(差多少学多少) */
  suggestedSize?: number;
}

/** 日凑整目标:比今日词数大的下一个整百 */
export const nextRoundTarget = (todayWordCount: number): number =>
  Math.floor(todayWordCount / 100) * 100 + 100;

/** 累计里程碑 */
export const MILESTONES = [100, 300, 500, 1000, 2000, 3000, 5000, 10000];

export const nextMilestone = (totalLearned: number): number | null =>
  MILESTONES.find((m) => m > totalLearned) ?? null;

/**
 * 当日钩子。巧合优先(里程碑 > 日凑整),但都要求「顺手就能凑到」——
 * gap 小于推荐量(凑整还要 ≤15)才出现;强求就不是巧合了。
 * 没有巧合时在常驻钩子里按日期轮换。
 */
export const pickEncoreHook = (input: EncoreHookInput): EncoreHook => {
  const milestone = nextMilestone(input.totalLearned);
  if (milestone != null) {
    const gap = milestone - input.totalLearned;
    if (gap >= 1 && gap <= Math.max(input.recommendedSize, 5)) {
      return { kind: "milestone", lead: `再 ${gap} 个,累计突破 ${milestone} 词`, suggestedSize: gap };
    }
  }

  const roundGap = nextRoundTarget(input.todayWordCount) - input.todayWordCount;
  if (
    input.todayWordCount > 0
    && roundGap >= 3
    && roundGap <= Math.min(15, Math.max(input.recommendedSize, 5))
  ) {
    return { kind: "round", lead: `顺手凑个整?离今日 ${nextRoundTarget(input.todayWordCount)} 只差 ${roundGap} 个`, suggestedSize: roundGap };
  }

  const evergreen: EncoreHook[] = [];
  if (input.weekEncoreCount >= 1) {
    evergreen.push({ kind: "streak", lead: `本周已加餐 ${input.weekEncoreCount} 次,再下一城` });
  }
  evergreen.push({ kind: "badge", lead: "加餐一批,给今天的炫耀图镶颗星" });
  const color = encoreDayColor(input.studyDate);
  evergreen.push({ kind: "color", lead: `今日${color.weekdayJp} · ${color.colorName}限定` });

  const dayOfYear = Math.floor(
    (new Date(`${input.studyDate}T00:00:00`).getTime() - new Date(`${input.studyDate.slice(0, 4)}-01-01T00:00:00`).getTime()) / 86_400_000
  );
  return evergreen[dayOfYear % evergreen.length];
};
