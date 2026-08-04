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
// 重学步骤(答错后):**两步**,要连对两次才当天过关。
//
// 一次「认识」不能当问题词的免死金牌 —— 答错阶段这个词出现得越来越密,你点认识的
// 那一刻答案往往刚看过,就那么放走等于白错一场。步长决定「答对后隔几个词再考」:
// 10 分档 ≈ 10 个词(见 requeue.ts 的 LONG_STEP_GAP)。
export const FSRS_RELEARNING_STEPS = ["10m", "10m"] as const;
/**
 * 顽固词的重学步骤:**三步**,要连对三次才放行。
 *
 * 判据是「当天已经错了几次」而不是「连错几次」—— 后者答对一次就清零,那样刚答对
 * 的瞬间这个词就不算顽固了,加码等于没加。当天错够 STUBBORN_DAILY_MISTAKES 次的词,
 * 剩下的一整天都按三步要求,中间再错一次退回第一步重来。
 *
 * 三步的间隔递增:第一次确认隔 ≈10 个词,第二次隔 ≈20 个词(30 分档),再对才放走。
 */
export const FSRS_STUBBORN_RELEARNING_STEPS = ["10m", "10m", "30m"] as const;
/** 当天错到这个次数 = 顽固词,升级到三步 */
export const STUBBORN_DAILY_MISTAKES = 3;
/**
 * 「当天首答奖励」:当天第一次看到就点「认识」——按 Easy 记,跳过学习步骤,直接毕业。
 *
 * 题面只给中文释义,是先回忆、再点「显示答案」、最后才评价。所以当天首答即「认识」
 * 意味着这次已经成功提取,不需要软件在同一学习日再安排短期确认。间隔由 FSRS 的
 * Easy 档计算,之后正常参与复习。
 */
export const FSRS_NO_STEPS = [] as const;
/** leech(顽固词)阈值:累计答错(lapses)达到即标记 */
export const LEECH_LAPSE_THRESHOLD = 8;

const DAY_MS = 86_400_000;

// 顽固词要用不同的重学步骤,所以实例按 (retention, maxInterval, 是否顽固) 分别缓存。
const schedulerCache = new Map<string, FSRS>();
/** normal=常规两步 / stubborn=顽固词三步 / known=当天首次认识,按 Easy 并跳过短步骤 */
export type StepMode = "normal" | "stubborn" | "known";

export const getScheduler = (
  retention = FSRS_DEFAULT_RETENTION,
  maxInterval = FSRS_MAX_INTERVAL_DAYS,
  mode: StepMode = "normal"
): FSRS => {
  const key = `${retention}|${maxInterval}|${mode}`;
  let instance = schedulerCache.get(key);
  if (!instance) {
    instance = fsrs({
      request_retention: retention,
      maximum_interval: maxInterval,
      enable_fuzz: false,        // 端侧可复现,不加随机抖动
      enable_short_term: true,   // 开学习步骤:新词/答错当天反复刷到毕业
      learning_steps: [...(mode === "known" ? FSRS_NO_STEPS : FSRS_LEARNING_STEPS)],
      relearning_steps: [
        ...(mode === "known"
          ? FSRS_NO_STEPS
          : mode === "stubborn"
            ? FSRS_STUBBORN_RELEARNING_STEPS
            : FSRS_RELEARNING_STEPS)
      ]
    });
    schedulerCache.set(key, instance);
  }
  return instance;
};

/**
 * 三答法 + 永久熟知 → FSRS 四档评分(Grade = 排除 Manual 的可调度档)
 *
 * mode === "known"(当天第一次看到就点「认识」)按 Easy 记:题面只给中文释义、
 * 是先回忆再看答案,这次首答正确说明今天不需要再把它塞回短期学习步骤。
 * FSRS 初始 stability 取 w[Easy] 而不是 w[Good],同时当天不再重复出题。
 */
export const ratingFor = (answer: WordAnswer, mode: StepMode = "normal"): Grade => {
  switch (answer) {
    case "know": return mode === "known" ? Rating.Easy : Rating.Good;
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
  opts: { retention?: number; maxInterval?: number; mode?: StepMode } = {}
): FsrsState {
  const retention = opts.retention ?? FSRS_DEFAULT_RETENTION;
  const maxInterval = opts.maxInterval ?? FSRS_MAX_INTERVAL_DAYS;
  const mode = opts.mode ?? "normal";
  const scheduler = getScheduler(retention, maxInterval, mode);
  const next = scheduler.repeat(toCard(prev, now), now)[ratingFor(answer, mode)].card;
  return cardToState(next, now, maxInterval);
}

/**
 * 「已掌握」判定:本次安排的间隔(下次到期 − 上次复习)达到这么多天。
 *
 * 取代旧的「3 连胜 + score ≥ 15」。间隔是 FSRS 自己算出来的记忆强度体现,
 * 排到半年以后就说明算法认为你已经记牢了 —— 不需要额外的计数器,
 * 也不会出现「连胜攒够但其实记得很勉强」的误判。
 */
export const MASTERED_INTERVAL_DAYS = 180;

export const intervalDays = (s: FsrsState): number =>
  (new Date(s.due).getTime() - new Date(s.lastReview).getTime()) / DAY_MS;

export const isMastered = (s: FsrsState | null | undefined): boolean =>
  hasState(s) ? intervalDays(s) >= MASTERED_INTERVAL_DAYS : false;

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
