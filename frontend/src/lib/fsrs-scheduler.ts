/**
 * FSRS-6 调度内核封装(词汇重建)
 *
 * 用官方 ts-fsrs(DSR 记忆模型)取代自研的「分数梯子 + 每日衰减」。
 *
 * 两层职责(采 Anki 标准做法,零自研):
 *  - 短期「学习步骤」(enable_short_term + learning/relearning steps):新词/答错的词
 *    当天反复刷,走完步骤才「毕业」。忘记→退回第一步,认识→进一步,毕业才转复习卡。
 *  - 长期调度(DSR):毕业后由稳定度 S 决定下次是哪天(可到数月/数年)。
 *
 * 三答法映射:认识→Good、模糊→Hard、忘记→Again、永久熟知→Easy。
 * 卡片全字段持久化(S/D/due/lastReview/state/steps/reps/lapses),学习步骤状态机才能正确 round-trip。
 * 间隔护栏(采自墨墨 SSP-MMC 的 interval_max 思想):低数据期封顶,避免 S 高段外推失准。
 */
import { fsrs, createEmptyCard, Rating, State, type Card, type FSRS, type Grade } from "ts-fsrs";
import type { WordAnswer } from "../types/vocabulary";

/** 唯一强度旋钮:目标记住率(到期即此刻 R 掉到该值) */
export const FSRS_DEFAULT_RETENTION = 0.9;
/** 间隔护栏:低数据期(长间隔样本少)封顶,避免 S 高段外推失准 */
export const FSRS_MAX_INTERVAL_DAYS = 365;
/** 学习步骤(新词/首次):走完才毕业。默认 1 分、10 分两步 = 需连续两次「认识」毕业 */
export const FSRS_LEARNING_STEPS = ["1m", "10m"] as const;
/** 重学步骤(复习卡答错=lapse 后):默认 10 分一步 */
export const FSRS_RELEARNING_STEPS = ["10m"] as const;
/** leech(顽固词)阈值:累计答错(lapses)达到即标记 */
export const LEECH_LAPSE_THRESHOLD = 8;

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
        enable_fuzz: false,        // 端侧可复现,不加随机抖动
        enable_short_term: true,   // 开学习步骤:新词/答错当天反复刷到毕业
        learning_steps: [...FSRS_LEARNING_STEPS],
        relearning_steps: [...FSRS_RELEARNING_STEPS]
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

/** 持久化到 progress 表的 FSRS 全字段(学习步骤状态机需要全字段才能正确 round-trip) */
export interface FsrsState {
  stability: number;
  difficulty: number;
  due: string;        // ISO
  lastReview: string; // ISO
  state: number;      // State 0=New 1=Learning 2=Review 3=Relearning
  steps: number;      // learning_steps:当前学习步索引
  reps: number;
  lapses: number;
}

const hasState = (s: FsrsState | null | undefined): s is FsrsState =>
  !!s && Number.isFinite(s.stability) && s.stability > 0 && !!s.due;

/** 从存储字段重建 ts-fsrs Card;无记录 = 新卡。旧四列数据缺 state/steps 时按复习卡兜底。 */
const toCard = (s: FsrsState | null | undefined, now: Date): Card => {
  if (!hasState(s)) return createEmptyCard(now);
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: Number.isFinite(s.steps) ? s.steps : 0,
    reps: Number.isFinite(s.reps) ? s.reps : 1,
    lapses: Number.isFinite(s.lapses) ? s.lapses : 0,
    state: Number.isFinite(s.state) ? (s.state as State) : State.Review,
    last_review: new Date(s.lastReview || s.due)
  };
};

const clampDue = (dueISO: string, lastReview: Date, maxInterval: number): string => {
  const cap = lastReview.getTime() + maxInterval * DAY_MS;
  const due = new Date(dueISO).getTime();
  return new Date(Math.min(due, cap)).toISOString();
};

const cardToState = (next: Card, now: Date, maxInterval: number): FsrsState => {
  const lastReview = next.last_review ?? now;
  return {
    stability: next.stability,
    difficulty: next.difficulty,
    due: clampDue(next.due.toISOString(), lastReview, maxInterval),
    lastReview: lastReview.toISOString(),
    state: next.state,
    steps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses
  };
};

/**
 * 记录一次作答(每次都调用——学习步骤靠每次作答推进/重置)。
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
  return cardToState(next, now, maxInterval);
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

/**
 * 是否「今天已毕业」= 下次到期排到了本学习日结束之后(不再当天重刷)。
 * 学习/重学中的卡 due 只排到几分钟后(仍 ≤ 边界)→ 未毕业,当天继续刷。
 */
export function isGraduatedForDay(s: FsrsState | null | undefined, studyDayEnd: Date): boolean {
  return hasState(s) && new Date(s.due).getTime() > studyDayEnd.getTime();
}

/** 是否处于学习/重学中(当天还要再出) */
export function isLearning(s: FsrsState | null | undefined): boolean {
  return hasState(s) && (s.state === State.Learning || s.state === State.Relearning || s.state === State.New);
}

/** 累计答错达阈值 = leech(顽固词) */
export const isLeech = (s: FsrsState | null | undefined): boolean =>
  hasState(s) && s.lapses >= LEECH_LAPSE_THRESHOLD;

/** 稳定度是否已达「毕业留存」门槛(替代自动退休判据) */
export const GRADUATION_STABILITY_DAYS = 180;
export const isGraduated = (s: FsrsState | null | undefined): boolean =>
  hasState(s) && s.stability >= GRADUATION_STABILITY_DAYS;
