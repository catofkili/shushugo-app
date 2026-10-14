import { rowsFor, today } from "./database/db-utils";
import { shiftDay } from "./zoo-streak";

export type DayStatus = "none" | "lit" | "gold" | "repaired";
export type FlameTier = 0 | 1 | 2 | 3 | 4 | 5;
export const STREAK_LIT = { answers: 20, seconds: 300 } as const;
export const STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365, 500, 1000] as const;
export interface StreakSnapshot {
  today: string; todayStatus: DayStatus; streak: number; longest: number; litDays: number;
  atRisk: boolean; tier: FlameTier; nextMilestone: number | null;
  todayAnswers: number; todaySeconds: number;
  /** 今天之前亮过的天数，区分第一天和重新点燃。 */
  everLitBefore: number;
  /**
   * 这一段连胜里的大火苗（金）个数。小火苗（亮 / 补签）只保连胜不断，大火苗才攒奖励：
   * 每攒满 7 个得一次 7 日连击柚子（作者 2026-10-14：「小火苗保连胜，大火苗得奖励」）。
   */
  goldInStreak: number;
}

export function streakTier(streak: number): FlameTier {
  return streak <= 0 ? 0 : streak < 7 ? 1 : streak < 30 ? 2 : streak < 100 ? 3 : streak < 365 ? 4 : 5;
}

export function isStreakMilestone(n: number): boolean {
  return STREAK_MILESTONES.some((milestone) => milestone === n);
}

export function summarizeStreak(statuses: Map<string, DayStatus>, day: string, hour: number, todayAnswers: number, todaySeconds: number): StreakSnapshot {
  const days = [...statuses].filter(([date, status]) => date <= day && status !== "none").map(([date]) => date).sort();
  const lit = new Set(days);
  const todayStatus = statuses.get(day) ?? "none";
  let cursor = todayStatus !== "none" ? day : shiftDay(day, -1);
  let streak = 0;
  let goldInStreak = 0;
  while (lit.has(cursor)) {
    streak += 1;
    if (statuses.get(cursor) === "gold") goldInStreak += 1;
    const previous = shiftDay(cursor, -1);
    if (previous === cursor) break;
    cursor = previous;
  }
  let longest = 0;
  let run = 0;
  days.forEach((date, i) => {
    run = i > 0 && shiftDay(days[i - 1], 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return {
    today: day, todayStatus, streak, longest, litDays: days.length,
    atRisk: streak > 0 && todayStatus === "none" && (hour >= 20 || hour < 4),
    tier: streakTier(streak), nextMilestone: STREAK_MILESTONES.find((n) => n > streak) ?? null,
    todayAnswers, todaySeconds, everLitBefore: days.filter((date) => date < day).length, goldInStreak
  };
}

/** 算「作答次数」的表和各自的学习日列。spelling / jlpt 是 cloud:false 的实验表，可能不存在 */
const ACTIVITY_TABLES = [
  ["reviews", "reviewed_on"], ["grammar_reviews", "reviewed_on"], ["kanji_unit_reviews", "reviewed_on"],
  ["spelling_reviews", "reviewed_on"], ["jlpt_answers", "answered_on"]
] as const;

function readActivity() {
  const answers = new Map<string, number>();
  const seconds = new Map<string, number>();
  const tables = new Set(rowsFor("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name)));
  for (const [table, column] of ACTIVITY_TABLES) {
    if (!tables.has(table)) continue;
    for (const row of rowsFor(`SELECT ${column} AS day, COUNT(*) AS answers FROM ${table} GROUP BY ${column}`)) {
      const day = String(row.day);
      answers.set(day, (answers.get(day) ?? 0) + Number(row.answers));
    }
  }
  for (const row of rowsFor("SELECT studied_on AS day, SUM(seconds) AS seconds FROM word_study_time GROUP BY studied_on")) {
    seconds.set(String(row.day), Number(row.seconds));
  }
  const statuses = new Map<string, DayStatus>();
  for (const day of new Set([...answers.keys(), ...seconds.keys()])) {
    if ((answers.get(day) ?? 0) >= STREAK_LIT.answers || (seconds.get(day) ?? 0) >= STREAK_LIT.seconds) statuses.set(day, "lit");
  }
  const repaired = new Set(rowsFor("SELECT key FROM yuzu_ledger WHERE kind IN ('repair', 'repair_card') GROUP BY key").map((row) => String(row.key)));
  for (const row of rowsFor("SELECT checked_on FROM checkins GROUP BY checked_on")) {
    const day = String(row.checked_on);
    statuses.set(day, repaired.has(day) ? "repaired" : "gold");
  }
  return { statuses, answers, seconds };
}

export function readDayStatuses(): Map<string, DayStatus> {
  return readActivity().statuses;
}

export function streakSnapshot(now = new Date()): StreakSnapshot {
  const { statuses, answers, seconds } = readActivity();
  const day = today(now);
  return summarizeStreak(statuses, day, now.getHours(), answers.get(day) ?? 0, seconds.get(day) ?? 0);
}

export function dayStatusesBetween(from: string, to: string): Record<string, DayStatus> {
  const statuses = readDayStatuses();
  const result: Record<string, DayStatus> = {};
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    result[day] = statuses.get(day) ?? "none";
    if (shiftDay(day, 1) === day) break;
  }
  return result;
}

export function repairableStreakDays(): string[] {
  const statuses = readDayStatuses();
  const first = [...statuses.keys()].sort()[0];
  if (!first) return [];
  const day = today();
  return Array.from({ length: 7 }, (_, i) => shiftDay(day, -i - 1)).filter((date) => date > first && !statuses.has(date));
}

/**
 * 学习页每答一题都要问一次「今天亮了没」（StreakSpark）：只查今天这一天，不扫全表。
 * 判据必须和 readActivity 一致，改一边要改另一边（streak.test.ts 有一条对拍）。
 */
export function todayStreakStatus(now = new Date()): DayStatus {
  const day = today(now);
  const one = (sql: string) => Number(rowsFor(sql, [day])[0]?.n ?? 0);
  if (one("SELECT COUNT(*) AS n FROM checkins WHERE checked_on = ?") > 0) {
    return one("SELECT COUNT(*) AS n FROM yuzu_ledger WHERE kind IN ('repair', 'repair_card') AND key = ?") > 0 ? "repaired" : "gold";
  }
  const tables = new Set(rowsFor("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name)));
  let answers = 0;
  for (const [table, column] of ACTIVITY_TABLES) {
    if (tables.has(table)) answers += one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`);
  }
  const seconds = one("SELECT COALESCE(SUM(seconds), 0) AS n FROM word_study_time WHERE studied_on = ?");
  return answers >= STREAK_LIT.answers || seconds >= STREAK_LIT.seconds ? "lit" : "none";
}
