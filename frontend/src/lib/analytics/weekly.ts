/**
 * 每周学习回顾的数据层。
 *
 * 当前产品口径：一个回顾周期是「上周日 14:00（含）到本周日 14:00（不含）」。
 * 统计范围是所有学习模式：正反向单词、语法、汉字读音和快速学习写入的作答。
 * 本模块只读数据库，不负责生成通知，也不写入学习数据。
 */

import { firstValue, rowsFor } from "../database/db-utils";

export interface WeekWindow {
  /** 展示用的周期首日（周日） */
  start: string;
  /** 兼容旧日汇总查询的最后一个完整日期（周六）；真实末点见 endAt */
  end: string;
  /** 周日 14:00 的本地毫秒时间戳 */
  startAt: number;
  /** 下一周日 14:00 的本地毫秒时间戳，左闭右开 */
  endAt: number;
}

const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const localDateTimeKey = (date: Date): string =>
  `${localDateKey(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const dateAt = (dateText: string, hour: number, minute = 0): Date => {
  const date = new Date(`${dateText}T00:00:00`);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const parseAnchor = (value: string | Date): Date => {
  if (value instanceof Date) return new Date(value);
  // 日期字符串必须按本地日期解释，不能让 UTC 解析在东亚时区前移一天。
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateAt(value, 12);
  return new Date(value);
};

const parseEventAt = (value: unknown, fallbackDay: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    // SQLite CURRENT_TIMESTAMP is UTC but has no suffix. Treat that exact shape
    // as UTC; parsing it as local time shifts old grammar/word rows by the
    // device offset and can move them across the 14:00 report boundary.
    const sqliteUtc = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/;
    const parsedValue = sqliteUtc.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value.includes("T") ? value : value.replace(" ", "T");
    const parsed = new Date(parsedValue);
    if (Number.isFinite(parsed.getTime())) return parsed.getTime();
  }
  const fallback = String(fallbackDay ?? "");
  const parsedFallback = /^\d{4}-\d{2}-\d{2}$/.test(fallback)
    ? dateAt(fallback, 12)
    : new Date(fallback);
  return Number.isFinite(parsedFallback.getTime()) ? parsedFallback.getTime() : NaN;
};

const tableExists = (table: string): boolean => rowsFor(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  [table]
).length > 0;

const shiftDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

/** 把一个时间点归入最近的周日 14:00 周期。 */
export const reportPeriodStart = (atMs: number): string => {
  const date = new Date(atMs);
  date.setHours(14, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  if (atMs < date.getTime()) date.setDate(date.getDate() - 7);
  return `${localDateKey(date)} 14:00`;
};

const completedBoundaryFor = (anchor: string | Date): Date => {
  const date = parseAnchor(anchor);
  if (!Number.isFinite(date.getTime())) return dateAt(localDateKey(new Date()), 14);
  const sunday = new Date(date);
  sunday.setHours(14, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  // 周日 14:00 之前，最近完成的周期仍然在上一个周日结束。
  if (date.getTime() < sunday.getTime()) sunday.setDate(sunday.getDate() - 7);
  return sunday;
};

const windowFromEndBoundary = (endBoundary: Date, offset: number): WeekWindow => {
  const end = shiftDays(endBoundary, offset * 7);
  const start = shiftDays(end, -7);
  return {
    start: localDateKey(start),
    end: localDateKey(shiftDays(end, -1)),
    startAt: start.getTime(),
    endAt: end.getTime()
  };
};

/**
 * 取最近一个已结束周期。offset=-1 是再往前一个周期，offset=1 是下一周期。
 * 传入日期字符串时，`2026-09-13` 表示当天 00:00，因此还没有结束 14:00 周期。
 */
export function getWeekWindow(anchor: string | Date = new Date(), offset = 0): WeekWindow {
  return windowFromEndBoundary(completedBoundaryFor(anchor), offset);
}

export function weekStartOf(dateText: string): string {
  const d = parseAnchor(dateText);
  if (!Number.isFinite(d.getTime())) return dateText;
  d.setDate(d.getDate() - d.getDay());
  return localDateKey(d);
}

export function windowDays(window: WeekWindow): string[] {
  const days: string[] = [];
  const cursor = dateAt(window.start, 0);
  for (let i = 0; i < 7; i += 1) {
    days.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export const isWeekend = (dateText: string): boolean => {
  const day = parseAnchor(dateText).getDay();
  return day === 0 || day === 6;
};

/* ------------------------------------------------------------------ *
 * 所有模式的学习事件
 * ------------------------------------------------------------------ */

type ActivityKind = "word" | "grammar" | "kanji";

interface ActivityEvent {
  kind: ActivityKind;
  id: string;
  wordId?: number;
  grammarId?: string;
  answer: string;
  direction?: string;
  eventSource?: string;
  day: string;
  at: number;
}

export interface WeeklyHighlight {
  date: string;
  text: string;
}

export interface WeeklyRevisitWord {
  wordId: number;
  text: string;
  count: number;
}

const readActivityEvents = (): ActivityEvent[] => {
  const events: ActivityEvent[] = [];
  if (tableExists("reviews")) {
    const columns = new Set(rowsFor("PRAGMA table_info(reviews)").map((row) => String(row.name ?? "")));
    const sourceColumn = columns.has("event_source") ? "event_source" : "'legacy' AS event_source";
    for (const row of rowsFor(`SELECT id, word_id, answer, direction, reviewed_on, reviewed_at, created_at, ${sourceColumn} FROM reviews`)) {
      const at = parseEventAt(row.reviewed_at ?? row.created_at, row.reviewed_on);
      events.push({
        kind: "word",
        id: `word:${String(row.id)}`,
        wordId: Number(row.word_id),
        answer: String(row.answer ?? ""),
        direction: String(row.direction ?? "forward"),
        eventSource: String(row.event_source ?? "legacy"),
        day: String(row.reviewed_on ?? localDateKey(new Date(at))),
        at
      });
    }
  }
  if (tableExists("grammar_reviews")) {
    for (const row of rowsFor("SELECT id, grammar_id, answer, reviewed_on, created_at FROM grammar_reviews")) {
      const at = parseEventAt(row.created_at, row.reviewed_on);
      events.push({
        kind: "grammar",
        id: `grammar:${String(row.id)}`,
        grammarId: String(row.grammar_id),
        answer: String(row.answer ?? ""),
        day: String(row.reviewed_on ?? localDateKey(new Date(at))),
        at
      });
    }
  }
  if (tableExists("grammar_activity_events")) {
    for (const row of rowsFor("SELECT id, grammar_id, answer, activity_on, activity_at, created_at FROM grammar_activity_events")) {
      const at = parseEventAt(row.activity_at ?? row.created_at, row.activity_on);
      events.push({
        kind: "grammar",
        id: `grammar-activity:${String(row.id)}`,
        grammarId: String(row.grammar_id),
        answer: String(row.answer ?? "read"),
        day: String(row.activity_on ?? localDateKey(new Date(at))),
        at
      });
    }
  }
  if (tableExists("kanji_unit_reviews")) {
    for (const row of rowsFor("SELECT id, unit_key, answer, reviewed_on, reviewed_at, created_at FROM kanji_unit_reviews")) {
      const at = parseEventAt(row.reviewed_at ?? row.created_at, row.reviewed_on);
      events.push({
        kind: "kanji",
        id: `kanji:${String(row.id)}`,
        answer: String(row.answer ?? ""),
        day: String(row.reviewed_on ?? localDateKey(new Date(at))),
        at
      });
    }
  }
  return events
    .filter((event) => event.answer !== "known_forever")
    .filter((event) => event.eventSource !== "bulk_complete")
    .filter((event) => Number.isFinite(event.at));
};

const eventInWindow = (event: ActivityEvent, window: WeekWindow): boolean =>
  event.at >= window.startAt && event.at < window.endAt;

const eventDay = (event: ActivityEvent): string => {
  const date = new Date(event.at);
  return Number.isFinite(date.getTime()) ? localDateKey(date) : event.day;
};

export interface DayStat {
  date: string;
  /** 当天所有模式的有效作答数 */
  reviews: number;
  /** 当天第一次正向见到的词数 */
  newWords: number;
  /** 当天计时器的旧日汇总；周日 14:00 边界附近只作日级近似展示 */
  seconds: number;
}

/**
 * 展示层只保留七个周日到周六的格子。
 *
 * 一个精确的 14:00→14:00 周期会碰到两个不同日期的周日；这两个半天
 * 在周报里合并到开始周日，避免把一周画成八天，同时事件筛选仍使用
 * 原来的毫秒边界，不会把边界外的作答算进总数。
 */
const displayDayFor = (date: string, window: WeekWindow, closingDay: string): string =>
  date === closingDay ? window.start : date;

export interface WeeklyMetrics {
  window: WeekWindow;
  /** 有任意模式作答的日历天数 */
  days: number;
  /** 兼容旧调用方，等于 totalSeconds 四舍五入到分钟 */
  minutes: number;
  totalSeconds: number;
  totalReviews: number;
  wordReviews: number;
  grammarReviews: number;
  kanjiReviews: number;
  /** 正向单词第一次见到的不同词数 */
  newWords: number;
  /** 所有模式作答中扣除本周新词首次作答后的次数 */
  reviewCount: number;
  daily: DayStat[];
  /** 截至这个周期结束日的连续学习日数 */
  streak: number;
  /** 截至周期结束时，有过任意模式作答的日期数 */
  cumulativeDays: number;
  /** 截至周期结束时，正向单词首次作答的不同词数 */
  cumulativeWords: number;
}

const eventDaysBefore = (events: ActivityEvent[], endAt: number): Set<string> => {
  const dates = new Set<string>();
  for (const event of events) if (event.at < endAt) dates.add(eventDay(event));
  return dates;
};

const streakAtEnd = (events: ActivityEvent[], window: WeekWindow): number => {
  const activeDays = eventDaysBefore(events, window.endAt);
  let count = 0;
  // 周期在周日 14:00 结束，最后一个可学习日是这个周日，不是旧的周六标签。
  const cursor = new Date(window.endAt - 1);
  while (activeDays.has(localDateKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
};

const firstForwardEvents = (events: ActivityEvent[]): ActivityEvent[] => {
  const firstByWord = new Map<number, ActivityEvent>();
  for (const event of events) {
    if (event.kind !== "word" || event.direction !== "forward" || event.wordId == null) continue;
    const existing = firstByWord.get(event.wordId);
    if (!existing || event.at < existing.at || (event.at === existing.at && event.id < existing.id)) {
      firstByWord.set(event.wordId, event);
    }
  }
  return [...firstByWord.values()];
};

const secondsInWindow = (window: WeekWindow): number => {
  // 新的按周期记账表优先；旧库没有它时退回日汇总，保证历史周报仍能读。
  if (tableExists("study_time_by_period")) {
    const periodSeconds = firstValue<number>(
      "SELECT COALESCE(SUM(seconds), 0) FROM study_time_by_period WHERE period_start = ?",
      [localDateTimeKey(new Date(window.startAt))],
      0
    );
    if (periodSeconds > 0) return periodSeconds;
  }
  if (!tableExists("word_study_time")) return 0;
  return firstValue<number>(
    "SELECT COALESCE(SUM(seconds), 0) FROM word_study_time WHERE studied_on BETWEEN ? AND ?",
    [window.start, window.end],
    0
  );
};

export function getStreak(window: WeekWindow = getWeekWindow()): number {
  return streakAtEnd(readActivityEvents(), window);
}

export function getWeeklyMetrics(window: WeekWindow): WeeklyMetrics {
  const events = readActivityEvents();
  const inWindow = events.filter((event) => eventInWindow(event, window));
  const firstWords = firstForwardEvents(events);
  const newInWindow = firstWords.filter((event) => eventInWindow(event, window));
  const closingDay = localDateKey(new Date(window.endAt - 1));
  const dailySeconds = new Map<string, number>();
  if (tableExists("word_study_time")) {
    for (const row of rowsFor(
      "SELECT studied_on, seconds FROM word_study_time WHERE studied_on BETWEEN ? AND ? AND seconds > 0",
      [window.start, closingDay]
    )) {
      const date = displayDayFor(String(row.studied_on), window, closingDay);
      dailySeconds.set(date, (dailySeconds.get(date) ?? 0) + Math.max(0, Number(row.seconds ?? 0)));
    }
  }
  // The 14:00→14:00 window contains a partial Sunday at each end. Keep seven
  // display labels and merge both Sunday halves into the first label.
  const days = windowDays(window);
  const daily: DayStat[] = days.map((date) => ({
    date,
    reviews: inWindow.filter((event) => displayDayFor(eventDay(event), window, closingDay) === date).length,
    newWords: newInWindow.filter((event) => displayDayFor(eventDay(event), window, closingDay) === date).length,
    seconds: dailySeconds.get(date) ?? 0
  }));
  const wordReviews = inWindow.filter((event) => event.kind === "word").length;
  const grammarReviews = inWindow.filter((event) => event.kind === "grammar").length;
  const kanjiReviews = inWindow.filter((event) => event.kind === "kanji").length;
  const totalReviews = inWindow.length;
  const totalSeconds = Math.max(0, Math.round(secondsInWindow(window)));
  const eventDays = new Set(inWindow.map((event) => displayDayFor(eventDay(event), window, closingDay)));
  const activeDays = new Set([...eventDays, ...dailySeconds.keys()]);
  const daysWithActivity = activeDays.size > 0 ? activeDays.size : totalSeconds > 0 ? 1 : 0;
  const cumulativeWordCount = firstWords.filter((event) => event.at < window.endAt).length;
  const cumulativeDays = eventDaysBefore(events, window.endAt);
  if (tableExists("word_study_time")) {
    for (const row of rowsFor("SELECT studied_on FROM word_study_time WHERE studied_on <= ? AND seconds > 0", [closingDay])) {
      cumulativeDays.add(String(row.studied_on));
    }
  }
  return {
    window,
    days: daysWithActivity,
    minutes: Math.round(totalSeconds / 60),
    totalSeconds,
    totalReviews,
    wordReviews,
    grammarReviews,
    kanjiReviews,
    newWords: newInWindow.length,
    reviewCount: Math.max(0, totalReviews - newInWindow.length),
    daily,
    streak: streakAtEnd(events, window),
    cumulativeDays: Math.max(cumulativeDays.size, totalSeconds > 0 ? 1 : 0),
    cumulativeWords: cumulativeWordCount
  };
}

/**
 * P4 高光页的最低门槛。
 *
 * 只有一天有记录时「最多的一天」没有比较对象；只有 1 次记录的一天也不值得
 * 单独占一页。这两个门槛只决定**要不要出这一页**，不改动任何数字。
 * 产品若要放宽，改这一个常量即可。
 */
export const WEEKLY_HIGHLIGHT_MIN_PEAK = 2;

export function getWeeklyHighlight(metrics: WeeklyMetrics): WeeklyHighlight | null {
  const active = metrics.daily.filter((item) => item.reviews > 0);
  // 少于两天就没有「最多的一天」可言；峰值太低也不凑数。
  if (active.length < 2) return null;
  const best = active.reduce((current, item) => item.reviews > current.reviews ? item : current);
  if (best.reviews < WEEKLY_HIGHLIGHT_MIN_PEAK) return null;
  return { date: best.date, text: `${best.date} 完成了 ${best.reviews} 次学习记录` };
}

export function getWeeklyRevisitWords(window: WeekWindow): WeeklyRevisitWord[] {
  const events = readActivityEvents().filter((event) => eventInWindow(event, window));
  const counts = new Map<number, { count: number; latest: number }>();
  for (const event of events) {
    // 「再见一面」是正向单词复习入口；反向卡的错误不能直接塞进同一批词，
    // unknown 也没有足够证据说明用户真的卡住了。
    if (event.kind !== "word" || event.direction !== "forward" || event.wordId == null || !["forgot", "fuzzy"].includes(event.answer)) continue;
    const previous = counts.get(event.wordId);
    counts.set(event.wordId, { count: (previous?.count ?? 0) + 1, latest: Math.max(previous?.latest ?? 0, event.at) });
  }
  if (!counts.size || !tableExists("words")) return [];
  const words = new Map<number, string>();
  for (const row of rowsFor("SELECT id, kanji, kana FROM words WHERE id IN (" + [...counts.keys()].map(() => "?").join(",") + ")", [...counts.keys()])) {
    words.set(Number(row.id), String(row.kanji || row.kana || `词条 ${row.id}`));
  }
  if (tableExists("custom_words")) {
    for (const row of rowsFor("SELECT word_id, kanji, kana FROM custom_words WHERE word_id IN (" + [...counts.keys()].map(() => "?").join(",") + ")", [...counts.keys()])) {
      words.set(Number(row.word_id), String(row.kanji || row.kana || `词条 ${row.word_id}`));
    }
  }
  return [...counts.entries()]
    .filter(([wordId]) => words.has(wordId))
    .map(([wordId, value]) => ({ wordId, text: words.get(wordId)!, count: value.count, latest: value.latest }))
    .sort((a, b) => b.count - a.count || b.latest - a.latest || a.wordId - b.wordId)
    .slice(0, 8)
    .map(({ wordId, text, count }) => ({ wordId, text, count }));
}

/* ------------------------------------------------------------------ *
 * 时间段与关键词
 * ------------------------------------------------------------------ */

export type Slot = "deepNight" | "earlyMorning" | "morning" | "afternoon" | "dusk" | "night";

const slotOfHour = (hour: number): Slot => {
  if (hour >= 22 || hour < 4) return "deepNight";
  if (hour < 8) return "earlyMorning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 20) return "dusk";
  return "night";
};

export interface SlotDistribution {
  counts: Record<Slot, number>;
  total: number;
  commuteShare: number;
}

export function getSlotDistribution(window: WeekWindow): SlotDistribution {
  const counts: Record<Slot, number> = {
    deepNight: 0, earlyMorning: 0, morning: 0, afternoon: 0, dusk: 0, night: 0
  };
  let total = 0;
  let commute = 0;
  for (const event of readActivityEvents().filter((item) => eventInWindow(item, window))) {
    const hour = new Date(event.at).getHours();
    counts[slotOfHour(hour)] += 1;
    total += 1;
    if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 19)) commute += 1;
  }
  return { counts, total, commuteShare: total > 0 ? commute / total : 0 };
}

const coefficientOfVariation = (values: number[]): number => {
  // 零新增日也属于观察窗口。过滤掉它们会把「5、5、0、0」误报成匀速，
  // 正好违背“零新增周不能被平均掉”的口径。
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return Number.POSITIVE_INFINITY;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
};

export const KEYWORD_RARITY: Record<string, number> = {
  复习派: 2, 铁人: 2, 匀速前进: 3, 攻坚手: 3, 夜行者: 3,
  通勤党: 4, 开荒者: 4, 周末突击手: 4, 早起鸟: 5, 单日爆发: 5
};

export interface KeywordCandidate {
  keyword: string;
  rarity: number;
}

const maxSlot = (counts: Record<Slot, number>): Slot | null => {
  let best: Slot | null = null;
  for (const key of Object.keys(counts) as Slot[]) {
    if (counts[key] === 0) continue;
    if (best === null || counts[key] > counts[best]) best = key;
  }
  return best;
};

export function getKeywordCandidates(metrics: WeeklyMetrics, slots: SlotDistribution): KeywordCandidate[] {
  const hits: string[] = [];
  const top = maxSlot(slots.counts);
  if (top === "deepNight") hits.push("夜行者");
  if (top === "earlyMorning") hits.push("早起鸟");
  if (slots.total > 0 && slots.commuteShare >= 0.35) hits.push("通勤党");

  const weekendReviews = metrics.daily
    .filter((day) => isWeekend(day.date))
    .reduce((sum, day) => sum + day.reviews, 0);
  if (metrics.totalReviews > 0 && weekendReviews / metrics.totalReviews >= 0.4) hits.push("周末突击手");
  if (metrics.streak >= 14) hits.push("铁人");
  if (coefficientOfVariation(metrics.daily.map((day) => day.newWords)) < 0.3) hits.push("匀速前进");

  const activeDays = metrics.daily.filter((day) => day.newWords > 0);
  if (activeDays.length > 0) {
    const peak = Math.max(...activeDays.map((day) => day.newWords));
    const mean = activeDays.reduce((sum, day) => sum + day.newWords, 0) / activeDays.length;
    if (mean > 0 && peak / mean >= 3) hits.push("单日爆发");
  }
  if (metrics.reviewCount > metrics.newWords) hits.push("复习派");
  if (metrics.newWords > metrics.reviewCount) hits.push("开荒者");

  // 这个标签只看本周期内的真实事件，不再依赖 reviewed_at 列是否存在。
  const hardCount = new Map<number, number>();
  for (const event of readActivityEvents().filter((item) => item.kind === "word" && eventInWindow(item, metrics.window))) {
    if (event.wordId != null) hardCount.set(event.wordId, (hardCount.get(event.wordId) ?? 0) + 1);
  }
  if ([...hardCount.values()].some((count) => count >= 5)) hits.push("攻坚手");

  return hits.map((keyword) => ({ keyword, rarity: KEYWORD_RARITY[keyword] ?? 3 }));
}

export const hashSeed = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export function pickKeyword(candidates: KeywordCandidate[], seed: string): KeywordCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const total = candidates.reduce((sum, candidate) => sum + candidate.rarity, 0);
  const roll = mulberry32(hashSeed(seed))() * total;
  let accumulated = 0;
  for (const candidate of candidates) {
    accumulated += candidate.rarity;
    if (roll < accumulated) return candidate;
  }
  return candidates[candidates.length - 1];
}

/* ------------------------------------------------------------------ *
 * 旧 API 的兼容数据。首发页面不展示模糊的人群对标和 ETA。
 * ------------------------------------------------------------------ */

export interface SpeedBand { level: 1 | 2 | 3 | 4; threshold: number; label: string; }
export const SPEED_BANDS: SpeedBand[] = [
  { level: 4, threshold: 100, label: "本周接触量很高" },
  { level: 3, threshold: 64, label: "本周接触量很充实" },
  { level: 2, threshold: 43, label: "本周接触量稳定" },
  { level: 1, threshold: 22, label: "本周接触了不少新词" }
];
export function getSpeedBand(newWords: number): SpeedBand | null {
  return SPEED_BANDS.find((band) => newWords >= band.threshold) ?? null;
}

export interface GoalEta { goal: string; goalWords: number; date: string; weeks: number; }
export const ETA_MAX_WEEKS = 104;
export function getGoalEta(): GoalEta | null { return null; }
/** 全部历史里最早一条学习事件的时间；没有记录时返回 Infinity。 */
const firstActivityAt = (): number => {
  const events = readActivityEvents();
  if (!events.length) return Number.POSITIVE_INFINITY;
  return events.reduce((earliest, event) => Math.min(earliest, event.at), Number.POSITIVE_INFINITY);
};

/**
 * 最近 n 周的周均新词数。
 *
 * ⚠️ 两个容易写错的地方：
 *   1. 账号开始使用之前的周**不算零学习周**，否则新用户第一周会被 4 周摊薄成四分之一；
 *   2. 开始使用之后的真实零新增周**必须保留**，否则「这周没学」会被平均掉。
 * 首个不完整周按一个已观察周计入（它确实是观察到的一周），行为固定并有测试。
 */
export function getRollingSpeed(window: WeekWindow, weeks = 4): number {
  const startedAt = firstActivityAt();
  let total = 0;
  let counted = 0;
  const end = new Date(window.endAt);
  for (let i = 0; i < weeks; i += 1) {
    const current = windowFromEndBoundary(shiftDays(end, -i * 7), 0);
    if (current.endAt <= startedAt) continue;
    total += getWeeklyMetrics(current).newWords;
    counted += 1;
  }
  return counted > 0 ? total / counted : 0;
}

export type ReferenceKind = "speed" | "goal" | "time" | "review" | "streak";
export interface ReferenceItem { kind: ReferenceKind; text: string; }
export const TIME_REF_MIN_MINUTES = 1;
const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours} 小时 ${rest} 分`;
  if (hours > 0) return `${hours} 小时`;
  return `${rest} 分钟`;
};
export const formatDateCn = (dateText: string): string => {
  const parts = dateText.split("-");
  return parts.length === 3 ? `${parts[0]} 年 ${Number(parts[1])} 月 ${Number(parts[2])} 日` : dateText;
};
export interface ReferenceContext {
  metrics: WeeklyMetrics;
  speedBand: SpeedBand | null;
  eta: GoalEta | null;
  takenKeywords?: string[];
}
export function buildReferences(ctx: ReferenceContext): ReferenceItem[] {
  const { metrics } = ctx;
  const references: ReferenceItem[] = [];
  if (metrics.totalSeconds >= 60 * TIME_REF_MIN_MINUTES) {
    references.push({ kind: "time", text: `这段时间你投入了 ${formatDuration(Math.floor(metrics.totalSeconds / 60))}` });
  }
  if (metrics.totalReviews > 0) {
    references.push({ kind: "review", text: `这段时间你完成了 ${metrics.totalReviews} 次学习` });
  }
  if (metrics.streak > 0 && !(ctx.takenKeywords ?? []).includes("铁人")) {
    references.push({ kind: "streak", text: `你连续 ${metrics.streak} 天与日语见面` });
  }
  return references;
}

export interface WeeklyReport {
  window: WeekWindow;
  metrics: WeeklyMetrics;
  keyword: KeywordCandidate | null;
  keywordCandidates: KeywordCandidate[];
  speedBand: SpeedBand | null;
  eta: GoalEta | null;
  references: ReferenceItem[];
  highlight: WeeklyHighlight | null;
  revisitWords: WeeklyRevisitWord[];
}

export function buildWeeklyReport(
  userSeed: string,
  offset = 0,
  today: string | Date = new Date()
): WeeklyReport {
  const window = getWeekWindow(today, offset);
  const metrics = getWeeklyMetrics(window);
  const slots = getSlotDistribution(window);
  const keywordCandidates = getKeywordCandidates(metrics, slots);
  const keyword = pickKeyword(keywordCandidates, `${userSeed}:${window.startAt}`);
  return {
    window,
    metrics,
    keyword,
    keywordCandidates,
    // 首发不再展示“效率 N 档”和“提前几周”的模糊预测。
    speedBand: null,
    eta: null,
    references: buildReferences({ metrics, speedBand: null, eta: null, takenKeywords: keyword ? [keyword.keyword] : [] }),
    highlight: getWeeklyHighlight(metrics),
    revisitWords: getWeeklyRevisitWords(window)
  };
}

/** 有任意模式的作答或有效计时，就有周报；没有内容才不生成。 */
export const WEEKLY_REPORT_MIN_DAYS = 1;
export const passesThreshold = (metrics: WeeklyMetrics): boolean =>
  metrics.totalReviews > 0 || metrics.totalSeconds > 0;
