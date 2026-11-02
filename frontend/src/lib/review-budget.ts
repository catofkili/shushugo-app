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
import { fsrsDueCount } from "./fsrs-store";
import { getReviewCapPreference, MAX_DAILY_REVIEW, PLAN_REVIEW_DISABLED, REVIEW_CAP_UNLIMITED } from "./studyPreferences";

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

/** 当前积压量 = FSRS 认为此刻到期、且仍参与正向调度的词数。 */
export const reviewBacklogCount = () => fsrsDueCount();

/**
 * 每日复习上限:
 *   REVIEW_CAP_UNLIMITED(负数) = 不限,当天到期的词一个不留全部给出;
 *   > 0 = 用户指定的固定值,超出的到期词顺延进积压,由续杯自然消化;
 *   0/未设置 = 自动档(近 30 天日均 × 1.5,夹 [60, 150])。
 */
export function dailyReviewCap(userCap: number, day = today()): number {
  if (userCap === REVIEW_CAP_UNLIMITED) return NO_REVIEW_LIMIT;
  if (userCap > 0) return Math.min(Math.max(Math.floor(userCap), 1), MAX_DAILY_REVIEW);
  return autoReviewCap(recentReviewAverages(day).avgDailyWords);
}

/**
 * 语法 / 汉字 / 辨析没设上限（0）时的自动档：**跟着这个用户自己这一类的学习量走**（2026-11-02，作者定的方向）。
 * 上限 = 近 14 天有学这一类的日子里，每天答过的条数取中位数 × 1.5，夹在 [floor, ceiling]。
 * - 为什么要有：汉字 / 辨析原来 0 = 到期全出，和 10-29 之前的语法一样没有天花板（语法 10-28 一天排了 154 条）；
 *   一个平时每天十几条的人，池子被范围放开 / 种子升版 / 合并撑大那天，当天就整批出。
 * - 为什么是中位数不是平均：爆量那一天本身不该把之后两周的上限抬上去。
 * - 为什么乘 1.5：给正常的起伏和新学留余量；上限卡住的部分顺延，下一天还在池子里。连续几天学得多，上限自己会跟上去。
 * - ceiling：语法 60 是作者 10-29 定的默认上限，保留为封顶；汉字 40 / 辨析 20 是 11-02 按作者真实库
 *   （近三周汉字每天 14–22 张、辨析 7 张）定的封顶，正常日子碰不到。
 * - floor：没有历史（新用户、刚开这一类）时给的量，约等于新学额度 5 条 / 天几天后的自然复习量。
 * 用户自己设了数（> 0）就用用户的，不受 floor / ceiling 约束（作者 10-29 定：用户设的上限优先）。
 * 先验额度另算，不受它约束（prior-pacing.ts）。
 */
export const PLAN_REVIEW_AUTO = {
  grammar: { table: "grammar_reviews", key: "grammar_id", floor: 20, ceiling: 60 },
  kanji: { table: "kanji_char_reviews", key: "char", floor: 15, ceiling: 40 },
  confusion: { table: "confusion_reviews", key: "group_key", floor: 8, ceiling: 20 }
} as const;
export type PlanReviewKind = keyof typeof PLAN_REVIEW_AUTO;
const PLAN_REVIEW_WINDOW_DAYS = 14;

export const autoPlanReviewCap = (kind: PlanReviewKind, day = today()): number => {
  const { table, key, floor, ceiling } = PLAN_REVIEW_AUTO[kind];
  const counts = rowsFor(`
    SELECT COUNT(DISTINCT ${key}) AS n FROM ${table}
    WHERE reviewed_on < ? AND reviewed_on >= date(?, '-${PLAN_REVIEW_WINDOW_DAYS} day')
    GROUP BY reviewed_on
  `, [day, day]).map((row) => Number(row.n)).sort((x, y) => x - y);
  const median = counts.length ? (counts[(counts.length - 1) >> 1] + counts[counts.length >> 1]) / 2 : 0;
  return Math.min(Math.max(Math.round(median * 1.5), floor), ceiling);
};

/**
 * 语法 / 汉字 / 辨析的普通复习上限，三类一个口径：PLAN_REVIEW_DISABLED = 不出；
 * 0 = 该类自动档（autoPlanReviewCap），且不超过单词上限；n = 用户自己定的。
 * 计划（daily-plan）和出题（grammar-quiz / mixed-cards）都从这里取，别各写一份。
 */
export const planReviewLimit = (cap: number, kind: PlanReviewKind, day = today()) =>
  cap === PLAN_REVIEW_DISABLED ? 0 : cap > 0 ? cap : Math.min(autoPlanReviewCap(kind, day), dailyReviewCap(getReviewCapPreference(), day));

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
