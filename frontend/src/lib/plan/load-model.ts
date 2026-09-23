export type LoadKind = "words" | "grammar" | "kanji" | "confusion";
export type LoadTier = "light" | "steady" | "heavy" | "aggressive";

export interface LoadPrediction {
  perWeek: Array<{ week: number; minutes: number; answers: number }>;
  peakWeek: number;
  steadyMinutes: number;
  tier: LoadTier;
}

const SECONDS: Record<LoadKind, number> = { words: 12, grammar: 25, kanji: 10, confusion: 40 };
// 这是压力预览，不是 FSRS 的第二套调度器。每批新内容前四周出现得密，之后稀疏。
const ANSWERS_BY_AGE_WEEK = [3, 2, 1.5, 1.5, 0.5, 0.5, 0.5, 0.5];

export const tierOf = (minutes: number): LoadTier => minutes <= 30 ? "light" : minutes <= 60 ? "steady" : minutes <= 90 ? "heavy" : "aggressive";

export function predictLoad(input: {
  dailyNew: Record<LoadKind, number>;
  existingDuePerWeek?: Array<Partial<Record<LoadKind, number>>>;
  intakeDaysLeft?: number;
  weeks?: number;
}): LoadPrediction {
  const weeks = Math.max(1, Math.min(12, input.weeks ?? 8));
  const intakeWeeks = Math.ceil(Math.max(0, input.intakeDaysLeft ?? weeks * 7) / 7);
  const perWeek = Array.from({ length: weeks }, (_, weekIndex) => {
    let seconds = 0;
    let answers = 0;
    for (const kind of Object.keys(SECONDS) as LoadKind[]) {
      let dailyAnswers = Number(input.existingDuePerWeek?.[weekIndex]?.[kind] ?? 0) / 7;
      for (let cohort = 0; cohort <= weekIndex && cohort < intakeWeeks; cohort += 1) {
        const age = weekIndex - cohort;
        dailyAnswers += input.dailyNew[kind] * (ANSWERS_BY_AGE_WEEK[age] ?? 0.5);
      }
      answers += dailyAnswers;
      seconds += dailyAnswers * SECONDS[kind];
    }
    return { week: weekIndex + 1, minutes: Math.round(seconds / 60), answers: Math.round(answers) };
  });
  const peak = perWeek.reduce((best, item) => item.minutes > best.minutes ? item : best, perWeek[0]);
  const steadyMinutes = perWeek[Math.min(3, perWeek.length - 1)].minutes;
  return { perWeek, peakWeek: peak.week, steadyMinutes, tier: tierOf(steadyMinutes) };
}
