/**
 * 回归模式（积压削峰摊还）
 *
 * 长期未打卡后待复习词会堆积成几百个。回归模式把积压按遗忘风险摊到未来若干天：
 * 每天只放出「今日容量」个复习词，其余留给后续天；期间暂停新词，直到积压清完。
 * 触发门槛：累计打卡满一周 + 连续至少两天未打卡 + 积压确实超出正常负荷。
 */

import { firstValue, rowsFor, getState, setState, today, daysSince } from "./database/db-utils";
import { getComebackModePreference, type ComebackMode } from "./studyPreferences";

export type { ComebackMode } from "./studyPreferences";

export interface ComebackState {
  active: boolean;
  startedOn: string;
  initialBacklog: number;
  planDays: number;
  capacity: number;
  /** 触发时快照的节奏偏好,回归全程不随设置改动而变 */
  mode: ComebackMode;
  evaluatedOn: string;
  announcedOn: string;
}

const EMPTY_STATE: ComebackState = {
  active: false,
  startedOn: "",
  initialBacklog: 0,
  planDays: 0,
  capacity: 0,
  mode: "gentle",
  evaluatedOn: "",
  announcedOn: ""
};

/** 温和档摊还天数 */
export const GENTLE_PLAN_DAYS = 7;
/** 高强度档:最多几天、每天最多摊多少(积压大也不超过此上限的档次) */
export const PRESSURE_MAX_DAYS = 3;
export const PRESSURE_PER_DAY = 250;

/** 触发回归模式要求的最少累计打卡天数（用满一周才谈得上「回归」） */
export const COMEBACK_MIN_CHECKIN_DAYS = 7;
/** 触发回归模式要求的最少连续未打卡天数 */
export const COMEBACK_MIN_MISSED_DAYS = 2;
/** 积压按预计耗时判定为「过重」的分钟阈值 */
export const COMEBACK_HEAVY_MINUTES = 40;

const CAPACITY_MIN = 60;
const CAPACITY_MAX = 150;
const FALLBACK_SECONDS_PER_WORD = 12;

export function readComebackState(): ComebackState {
  try {
    const raw = JSON.parse(getState("comeback_state", "{}"));
    if (!raw || typeof raw !== "object") return EMPTY_STATE;
    return {
      active: Boolean(raw.active),
      startedOn: String(raw.startedOn ?? ""),
      initialBacklog: Number(raw.initialBacklog ?? 0),
      planDays: Number(raw.planDays ?? 0),
      capacity: Number(raw.capacity ?? 0),
      mode: raw.mode === "pressure" ? "pressure" : "gentle",
      evaluatedOn: String(raw.evaluatedOn ?? ""),
      announcedOn: String(raw.announcedOn ?? "")
    };
  } catch {
    return EMPTY_STATE;
  }
}

const writeComebackState = (state: ComebackState) => {
  setState("comeback_state", JSON.stringify(state));
};

/** 今日容量 = 近期日均复习量 × 1.5，夹在 [60, 150] */
export const comebackCapacity = (avgDailyWords: number): number => (
  Math.min(Math.max(Math.round(avgDailyWords * 1.5), CAPACITY_MIN), CAPACITY_MAX)
);

/**
 * 触发时锁定的摊还天数（全程不变，界面据此显示且只显示这个数）：
 * - 温和档：固定 7 天，由轻到重的阶梯；
 * - 高强度档：按积压大小 2~3 天清完（每天约 PRESSURE_PER_DAY），小积压 1 天。
 */
export const comebackPlanDays = (mode: ComebackMode, backlog: number): number => (
  mode === "pressure"
    ? Math.min(Math.max(Math.ceil(backlog / PRESSURE_PER_DAY), 1), PRESSURE_MAX_DAYS)
    : GENTLE_PLAN_DAYS
);

/**
 * 今日应放出的积压词数。dayIndex 从 1 起，remaining 是当前实际积压量。
 * - 高强度：把剩余均摊到剩余天数（ceil，尽快清完）；
 * - 温和：位置权重 w(i)=i+2 递增，今天取「本日权重 ÷ 剩余各天权重和」× 剩余，
 *   于是由轻到重、且随实际清理进度自我校正；超期兜底不砸盘。
 */
export const comebackDailyTarget = (state: ComebackState, dayIndex: number, remaining: number): number => {
  if (remaining <= 0) return 0;
  const daysLeft = Math.max(state.planDays - dayIndex + 1, 1);
  if (state.mode === "pressure") {
    return Math.min(Math.max(Math.ceil(remaining / daysLeft), 1), remaining);
  }
  // 温和档：超过计划天数就按上限收尾，避免维护词灌大后一次性砸下来
  if (dayIndex > state.planDays) {
    return Math.min(remaining, CAPACITY_MAX);
  }
  let weightSum = 0;
  for (let i = dayIndex; i <= state.planDays; i += 1) weightSum += i + 2;
  const todayWeight = dayIndex + 2;
  const target = Math.round((remaining * todayWeight) / Math.max(weightSum, 1));
  return Math.min(Math.max(target, 1), remaining);
};

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


export interface ComebackTriggerInput {
  checkinDays: number;
  missedDays: number;
  backlog: number;
  avgDailyWords: number;
  secondsPerWord: number;
  capacity: number;
}

export const shouldActivateComeback = (input: ComebackTriggerInput): boolean => {
  if (input.checkinDays < COMEBACK_MIN_CHECKIN_DAYS) return false;
  if (input.missedDays < COMEBACK_MIN_MISSED_DAYS) return false;
  // 积压一天之内能清完就没必要进回归模式
  if (input.backlog <= input.capacity) return false;
  const heavyByCount = input.avgDailyWords > 0 && input.backlog > input.avgDailyWords * 2;
  const heavyByTime = (input.backlog * input.secondsPerWord) / 60 > COMEBACK_HEAVY_MINUTES;
  return heavyByCount || heavyByTime;
};

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

/** 当前积压量 = 已见、未永久掌握、分数已掉到 ≤6 的词数 */
export const reviewBacklogCount = () => firstValue<number>(`
  SELECT COUNT(*)
  FROM progress
  WHERE known_forever = 0 AND seen_count > 0 AND score <= 6
`, [], 0);

/**
 * 每日复习上限(常驻,不只回归模式):用户设置优先,0/未设置走自动档
 * (近 30 天日均 × 1.5,夹 [60, 150],与回归容量同公式)。
 * 超出的到期词顺延进积压,由回归模式/续杯自然消化。
 */
export function dailyReviewCap(userCap: number, day = today()): number {
  if (userCap > 0) return Math.min(Math.max(Math.floor(userCap), 30), 500);
  return comebackCapacity(recentReviewAverages(day).avgDailyWords);
}

/**
 * 每天建任务前评估一次回归状态。只应在当日任务尚未创建时调用
 * （激活会改变当日容量，任务建好后再激活就迟了）。
 */
export function evaluateComeback(day = today()): ComebackState {
  const state = readComebackState();
  if (state.evaluatedOn === day) return state;

  const backlog = reviewBacklogCount();

  if (state.active) {
    // 积压降到一天容量以内 → 回归计划完成，恢复正常模式
    const next = backlog > state.capacity
      ? { ...state, evaluatedOn: day }
      : { ...EMPTY_STATE, evaluatedOn: day };
    writeComebackState(next);
    return next;
  }

  const checkinDays = firstValue<number>("SELECT COUNT(DISTINCT checked_on) FROM checkins", [], 0);
  const lastCheckin = firstValue<string | null>("SELECT MAX(checked_on) FROM checkins", [], null);
  const missedDays = lastCheckin ? Math.max(daysSince(lastCheckin) - 1, 0) : 0;
  const { avgDailyWords, secondsPerWord } = recentReviewAverages(day);
  const capacity = comebackCapacity(avgDailyWords);

  if (shouldActivateComeback({ checkinDays, missedDays, backlog, avgDailyWords, secondsPerWord, capacity })) {
    const mode = getComebackModePreference();
    const next: ComebackState = {
      active: true,
      startedOn: day,
      initialBacklog: backlog,
      // 触发时锁定，全程不再重算 → 天数只会随进度往下走，绝不逐日上涨
      planDays: comebackPlanDays(mode, backlog),
      capacity,
      mode,
      evaluatedOn: day,
      announcedOn: ""
    };
    writeComebackState(next);
    return next;
  }

  const next = { ...EMPTY_STATE, evaluatedOn: day };
  writeComebackState(next);
  return next;
}

/** 只读当前状态：仅当今天已评估过且激活时返回，绝不触发激活/停用 */
export function currentComeback(day = today()): ComebackState | null {
  const state = readComebackState();
  return state.active && state.evaluatedOn === day ? state : null;
}

export function markComebackAnnouncedOn(day = today()): void {
  const state = readComebackState();
  writeComebackState({ ...state, announcedOn: day });
}

/**
 * 回归进行中当场切档（欢迎卡上的 🌱/⚡ 切换）：按初始积压重算 planDays，
 * 当天目标随之改变（调用方需重建当日任务）。未激活则空操作。
 */
export function retuneComebackMode(mode: ComebackMode): ComebackState {
  const state = readComebackState();
  if (!state.active) return state;
  const next: ComebackState = { ...state, mode, planDays: comebackPlanDays(mode, state.initialBacklog) };
  writeComebackState(next);
  return next;
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
