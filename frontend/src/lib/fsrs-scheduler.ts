/**
 * FSRS-6 调度内核封装(词汇重建 · 阶段 P0/P1)
 *
 * 用官方 ts-fsrs(DSR 记忆模型)取代自研的「分数梯子 + 每日衰减」。
 * 每张卡只持久化 4 个量:稳定度 S、难度 D、下次到期 due、上次复习 lastReview。
 * 是否到期 = now ≥ due(等价于可提取性 R 掉到目标记住率);无每日批量衰减,R 查询时现算。
 *
 * 三答法映射:认识→Good、模糊→Hard、忘记→Again、永久熟知→Easy。
 * 间隔护栏(采自墨墨 SSP-MMC 的 interval_max 思想):低数据期不让 S 外推出过长间隔,
 * 双保险——既设 ts-fsrs 的 maximum_interval,又在写回时手工夹一次 due。
 */
import { fsrs, createEmptyCard, Rating, State, type Card, type FSRS, type Grade } from "ts-fsrs";
import type { WordAnswer } from "../types/vocabulary";

/** 唯一强度旋钮:目标记住率(到期即此刻 R 掉到该值) */
export const FSRS_DEFAULT_RETENTION = 0.9;
/** 间隔护栏:低数据期(长间隔样本少)封顶,避免 S 高段外推失准 */
export const FSRS_MAX_INTERVAL_DAYS = 365;

const DAY_MS = 86_400_000;

let cache: { retention: number; maxInterval: number; instance: FSRS } | null = null;
export const getScheduler = (
  retention = FSRS_DEFAULT_RETENTION,
  maxInterval = FSRS_MAX_INTERVAL_DAYS
): FSRS => {
  if (!cache || cache.retention !== retention || cache.maxInterval !== maxInterval) {
    cache = {
      retention,
      maxInterval,
      instance: fsrs({
        request_retention: retention,
        maximum_interval: maxInterval,
        enable_fuzz: false,       // 端侧可复现,不加随机抖动
        enable_short_term: false  // 按「天」调度:同日重复不占额外名额,一日一评
      })
    };
  }
  return cache.instance;
};

/** 三答法 + 永久熟知 → FSRS 四档评分(Grade = 排除 Manual 的可调度档) */
export const ratingFor = (answer: WordAnswer): Grade => {
  switch (answer) {
    case "know": return Rating.Good;
    case "fuzzy": return Rating.Hard;
    case "forgot": return Rating.Again;
    case "known_forever": return Rating.Easy;
    default: return Rating.Good;
  }
};

/** 持久化到 progress 表的 4 个 FSRS 字段 */
export interface FsrsState {
  stability: number;
  difficulty: number;
  due: string;        // ISO
  lastReview: string; // ISO
}

const hasState = (s: FsrsState | null | undefined): s is FsrsState =>
  !!s && Number.isFinite(s.stability) && s.stability > 0 && !!s.due;

/** 从存储字段重建 ts-fsrs Card;无记录 = 新卡 */
const toCard = (s: FsrsState | null | undefined, now: Date): Card => {
  if (!hasState(s)) return createEmptyCard(now);
  const last = new Date(s.lastReview || s.due);
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: State.Review,
    last_review: last
  };
};

const clampDue = (dueISO: string, lastReview: Date, maxInterval: number): string => {
  const cap = lastReview.getTime() + maxInterval * DAY_MS;
  const due = new Date(dueISO).getTime();
  return new Date(Math.min(due, cap)).toISOString();
};

/**
 * 记录一次「当日首见」作答,返回新的 FSRS 状态。
 * prev 为空 = 该词首次进入 FSRS 调度。
 */
export function recordReview(
  prev: FsrsState | null | undefined,
  answer: WordAnswer,
  now: Date,
  opts: { retention?: number; maxInterval?: number } = {}
): FsrsState {
  const retention = opts.retention ?? FSRS_DEFAULT_RETENTION;
  const maxInterval = opts.maxInterval ?? FSRS_MAX_INTERVAL_DAYS;
  const scheduler = getScheduler(retention, maxInterval);
  const next = scheduler.repeat(toCard(prev, now), now)[ratingFor(answer)].card;
  const lastReview = next.last_review ?? now;
  return {
    stability: next.stability,
    difficulty: next.difficulty,
    due: clampDue(next.due.toISOString(), lastReview, maxInterval),
    lastReview: lastReview.toISOString()
  };
}

/** 此刻的可提取性 R ∈ [0,1] */
export function retrievability(s: FsrsState, now: Date): number {
  return getScheduler().get_retrievability(toCard(s, now), now, false) as number;
}

/** 是否到期(now ≥ due) */
export function isDue(s: FsrsState | null | undefined, now: Date): boolean {
  if (!hasState(s)) return true; // 无调度记录视同到期(等待首评)
  return new Date(s.due).getTime() <= now.getTime();
}

/** 稳定度是否已达「毕业」门槛(替代自动退休判据) */
export const GRADUATION_STABILITY_DAYS = 180;
export const isGraduated = (s: FsrsState | null | undefined): boolean =>
  hasState(s) && s.stability >= GRADUATION_STABILITY_DAYS;
