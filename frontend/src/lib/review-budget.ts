/**
 * 复习预算：每日复习上限 + 续杯（加餐）批量 + 疲劳检测。
 *
 * 每天到期的词可能远多于一次能认真做完的量，这里负责把它裁到一个可完成的数字，
 * 超出的顺延到后面几天（按遗忘风险排队，不会丢）。做完当日计划后想再来一批，
 * 走「续杯」：批量随剩余积压递减，收尾越来越轻；答题质量明显下滑时不再劝续杯。
 *
 * 注：本文件原名 comeback.ts，回归模式（断签后按计划摊还积压）已整体移除，
 *     只留下这些与回归无关、常驻生效的部分。
 */

import { firstValue, rowsFor, getState, setState, today } from "./database/db-utils";
import { isFsrsActive, fsrsDueCount } from "./fsrs-store";
import { REVIEW_CAP_UNLIMITED } from "./studyPreferences";

const AUTO_CAP_MIN = 60;
const AUTO_CAP_MAX = 150;
const FALLBACK_SECONDS_PER_WORD = 12;

/**
 * 「不限」时用的哨兵额度:大到任何 SQL LIMIT 都不会真正截断,
 * 又小到能安全地当整数绑进 sql.js(别用 MAX_SAFE_INTEGER,会被当浮点绑定)。
 */
export const NO_REVIEW_LIMIT = 1_000_000_000;

/** 自动档上限 = 近期日均复习量 × 1.5，夹在 [60, 150] */
export const autoReviewCap = (avgDailyWords: number): number => (
  Math.min(Math.max(Math.round(avgDailyWords * 1.5), AUTO_CAP_MIN), AUTO_CAP_MAX)
);

/**
 * 续杯批量：取剩余积压的 30% 向上取整到 5 的倍数，夹在 [5, 50]。
 * 随剩余量缩小自然递减（600→50、100→30、30→10、12→5），收尾越来越轻。
 */
export const encoreChunkSize = (remaining: number): number => {
  if (remaining <= 0) return 0;
  if (remaining <= 5) return remaining;
  const chunk = Math.ceil((remaining * 0.3) / 5) * 5;
  return Math.min(Math.max(chunk, 5), 50, remaining);
};

/** 加餐记录:本周次数(连击钩子)+ 今日加餐词数(炫耀图徽章),存 state 表随库持久化 */
export interface EncoreLog {
  weekKey: string;
  weekCount: number;
  day: string;
  dayWords: number;
}

/** 周键 = 本周日曜日的日期,跨周自动归零 */
export const encoreWeekKey = (day: string): string => {
  const base = new Date(`${day}T00:00:00`);
  base.setDate(base.getDate() - base.getDay());
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const date = String(base.getDate()).padStart(2, "0");
  return `${base.getFullYear()}-${month}-${date}`;
};

export function readEncoreLog(day: string): EncoreLog {
  const weekKey = encoreWeekKey(day);
  try {
    const raw = JSON.parse(getState("encore_log", "{}"));
    return {
      weekKey,
      weekCount: raw.weekKey === weekKey ? Number(raw.weekCount) || 0 : 0,
      day,
      dayWords: raw.day === day ? Number(raw.dayWords) || 0 : 0
    };
  } catch {
    return { weekKey, weekCount: 0, day, dayWords: 0 };
  }
}

export function recordEncore(day: string, words: number): void {
  const log = readEncoreLog(day);
  setState("encore_log", JSON.stringify({
    weekKey: log.weekKey,
    weekCount: log.weekCount + 1,
    day,
    dayWords: log.dayWords + words
  }));
}

export const estimatedMinutesFor = (wordCount: number, secondsPerWord: number): number => (
  wordCount <= 0 ? 0 : Math.max(Math.ceil((wordCount * secondsPerWord) / 60), 1)
);

/** 近 30 天（不含今天）的日均复习词数与平均每词耗时 */
export function recentReviewAverages(day = today()): { avgDailyWords: number; secondsPerWord: number } {
  const perDay = rowsFor(`
    SELECT reviewed_on, COUNT(DISTINCT word_id) AS words
    FROM reviews
    WHERE reviewed_on < ? AND reviewed_on >= date(?, '-30 day')
    GROUP BY reviewed_on
  `, [day, day]);
  const totalWords = perDay.reduce((sum, row) => sum + Number(row.words ?? 0), 0);
  const avgDailyWords = perDay.length ? totalWords / perDay.length : 0;
  const totalSeconds = firstValue<number>(`
    SELECT COALESCE(SUM(seconds), 0)
    FROM word_study_time
    WHERE studied_on < ? AND studied_on >= date(?, '-30 day')
  `, [day, day], 0);
  const secondsPerWord = totalWords > 0 && totalSeconds > 0
    ? Math.min(Math.max(totalSeconds / totalWords, 6), 45)
    : FALLBACK_SECONDS_PER_WORD;
  return { avgDailyWords, secondsPerWord };
}

/** 当前积压量 = 已见、未永久掌握、到期待复习的词数。
 *  FSRS 开关打开时用「FSRS 到期数」,否则用现行「分数 ≤6」。语义等价:都是"此刻该复习多少"。 */
export const reviewBacklogCount = () => {
  if (isFsrsActive()) return fsrsDueCount();
  return firstValue<number>(`
    SELECT COUNT(*)
    FROM progress
    WHERE known_forever = 0 AND seen_count > 0 AND score <= 6
  `, [], 0);
};

/**
 * 每日复习上限:
 *   REVIEW_CAP_UNLIMITED(负数) = 不限,当天到期的词一个不留全部给出;
 *   > 0 = 用户指定的固定值,超出的到期词顺延进积压,由续杯自然消化;
 *   0/未设置 = 自动档(近 30 天日均 × 1.5,夹 [60, 150])。
 */
export function dailyReviewCap(userCap: number, day = today()): number {
  if (userCap === REVIEW_CAP_UNLIMITED) return NO_REVIEW_LIMIT;
  if (userCap > 0) return Math.min(Math.max(Math.floor(userCap), 30), 500);
  return autoReviewCap(recentReviewAverages(day).avgDailyWords);
}

/**
 * 疲劳检测：今天答题已不少于 40 个，且最近 20 个的出错率 ≥40% 并比全天
 * 平均高出 15 个百分点以上 —— 这时不再劝续杯，避免硬撑刷出一堆 forgot。
 */
export function fatigueDetected(day = today()): boolean {
  const totalToday = firstValue<number>(
    "SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?",
    [day],
    0
  );
  if (totalToday < 40) return false;
  const recent = rowsFor(
    "SELECT answer FROM reviews WHERE reviewed_on = ? ORDER BY id DESC LIMIT 20",
    [day]
  );
  if (recent.length < 20) return false;
  const isMiss = (answer: unknown) => answer === "forgot" || answer === "fuzzy";
  const recentErrorRate = recent.filter((row) => isMiss(row.answer)).length / recent.length;
  const overallMisses = firstValue<number>(
    "SELECT COUNT(*) FROM reviews WHERE reviewed_on = ? AND answer IN ('forgot', 'fuzzy')",
    [day],
    0
  );
  const overallErrorRate = overallMisses / totalToday;
  return recentErrorRate >= 0.4 && recentErrorRate >= overallErrorRate + 0.15;
}
