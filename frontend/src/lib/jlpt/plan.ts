/**
 * JLPT 备考计划的纯计算层。
 *
 * 只做一件事:给定「考试还有几天」和「范围内还剩多少没学」,算出**今天最少要做多少**
 * 才不掉队。不碰数据库、不碰偏好、不碰时间以外的全局状态——所以能直接写测试。
 *
 * 刻意不做的事:
 * - 不排「今天学哪几个词」。那是 scheduler/ 的活,这里只给数量。
 * - 不给「建议量」「冲刺量」这类第二档。**最低量**只有一个数才有约束力,
 *   给两个数的结果是人永远看低的那个。
 */

export type JlptTarget = "N5" | "N4" | "N3" | "N2" | "N1";

export const JLPT_TARGETS: JlptTarget[] = ["N5", "N4", "N3", "N2", "N1"];

/**
 * 考 X 级要覆盖的等级范围。
 *
 * JLPT 考的是**累计**内容:N3 的卷子里 N4/N5 的词和语法照样出,所以范围是 X 及以下。
 * 无级别的词(入口/戦争这类基础词)一律算在内。
 */
export const levelsInScope = (target: JlptTarget): JlptTarget[] =>
  JLPT_TARGETS.slice(0, JLPT_TARGETS.indexOf(target) + 1);

/** 考前多少天停止进新内容,全部转复习 */
export const CONSOLIDATION_DAYS = 21;
/** 考前多少天进入「只清到期、不碰没把握的」 */
export const EXAM_WEEK_DAYS = 7;
/** 过期积压摊到几天里还,不要求一天清完 */
export const BACKLOG_SPREAD_DAYS = 7;
/** 每日新词/新语法的物理上限,超过就是计划本身不可行,得换考期而不是硬扛 */
export const MAX_DAILY_NEW_WORDS = 50;
export const MAX_DAILY_NEW_GRAMMAR = 12;

/** 备考阶段。数量怎么算全看它,别在别处再判一次天数。 */
export type PlanPhase = "intake" | "consolidate" | "exam-week" | "past";

export interface PlanInputs {
  /** 今天(学习日,不是自然日) */
  today: Date;
  examDate: Date;
  /** 范围内没学过的词 */
  unseenWords: number;
  /** 范围内没学过的语法点 */
  unseenGrammar: number;
  /** 今天才到期的词 */
  freshDueWords: number;
  /** 之前就到期、拖到今天的词 */
  overdueWords: number;
  freshDueGrammar: number;
  overdueGrammar: number;
}

export interface DailyMinimum {
  daysLeft: number;
  /** 还能进新内容的天数(已扣掉考前的复习期) */
  intakeDaysLeft: number;
  phase: PlanPhase;
  newWords: number;
  reviewWords: number;
  newGrammar: number;
  reviewGrammar: number;
  /** 按上限也吃不完:这时候要么降目标,要么改考期,不是靠"再努力一点" */
  feasible: boolean;
  /** 全部覆盖完实际需要多少天(按上限算),feasible 为 false 时用来说明差多少 */
  daysNeeded: number;
}

const dayMs = 86400000;

/** 两个日期差几天,按自然日算(不看时分秒),负数表示已经过了 */
export const daysBetween = (from: Date, to: Date): number => {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / dayMs);
};

const phaseFor = (daysLeft: number): PlanPhase => {
  if (daysLeft < 0) return "past";
  if (daysLeft <= EXAM_WEEK_DAYS) return "exam-week";
  if (daysLeft <= CONSOLIDATION_DAYS) return "consolidate";
  return "intake";
};

/**
 * 摊还:每天要还的量 = 还剩多少 ÷ 还有几天,向上取整。
 * 天数 ≤ 0 时全压到今天——真到那天了就是今天全做完,没有"以后"可以摊。
 */
const amortize = (remaining: number, days: number): number => {
  if (remaining <= 0) return 0;
  if (days <= 0) return remaining;
  return Math.ceil(remaining / days);
};

export const computeDailyMinimum = (input: PlanInputs): DailyMinimum => {
  const daysLeft = daysBetween(input.today, input.examDate);
  const phase = phaseFor(daysLeft);
  // 考前 CONSOLIDATION_DAYS 天不再进新内容:新学的词在考试前根本走不完
  // 一个 FSRS 循环,考场上等于没记住,却要占掉复习时间。
  const intakeDaysLeft = Math.max(daysLeft - CONSOLIDATION_DAYS, 0);
  const takingNew = phase === "intake";

  const newWords = takingNew ? amortize(input.unseenWords, intakeDaysLeft) : 0;
  const newGrammar = takingNew ? amortize(input.unseenGrammar, intakeDaysLeft) : 0;

  // 到期的分两块:今天到期的必须今天做完(不然明天就成了积压),
  // 已经过期的那堆摊到一周里还,免得开屏就是 700 个直接把人劝退。
  const backlogDays = Math.max(Math.min(BACKLOG_SPREAD_DAYS, daysLeft), 1);
  const reviewWords = input.freshDueWords + amortize(input.overdueWords, backlogDays);
  const reviewGrammar = input.freshDueGrammar + amortize(input.overdueGrammar, backlogDays);

  const daysNeeded = Math.max(
    Math.ceil(input.unseenWords / MAX_DAILY_NEW_WORDS),
    Math.ceil(input.unseenGrammar / MAX_DAILY_NEW_GRAMMAR)
  );

  return {
    daysLeft,
    intakeDaysLeft,
    phase,
    newWords: Math.min(newWords, MAX_DAILY_NEW_WORDS),
    reviewWords,
    newGrammar: Math.min(newGrammar, MAX_DAILY_NEW_GRAMMAR),
    reviewGrammar,
    feasible: newWords <= MAX_DAILY_NEW_WORDS && newGrammar <= MAX_DAILY_NEW_GRAMMAR,
    daysNeeded: daysNeeded + CONSOLIDATION_DAYS
  };
};

/** 今天实际做了多少 */
export interface TodayProgress {
  newWordsDone: number;
  reviewWordsDone: number;
  newGrammarDone: number;
  reviewGrammarDone: number;
}

export interface Shortfall {
  newWords: number;
  reviewWords: number;
  newGrammar: number;
  reviewGrammar: number;
  /** 四项都清零了 */
  clear: boolean;
}

export const shortfallOf = (plan: DailyMinimum, done: TodayProgress): Shortfall => {
  const gap = (target: number, actual: number) => Math.max(target - actual, 0);
  const newWords = gap(plan.newWords, done.newWordsDone);
  const reviewWords = gap(plan.reviewWords, done.reviewWordsDone);
  const newGrammar = gap(plan.newGrammar, done.newGrammarDone);
  const reviewGrammar = gap(plan.reviewGrammar, done.reviewGrammarDone);
  return {
    newWords,
    reviewWords,
    newGrammar,
    reviewGrammar,
    clear: newWords + reviewWords + newGrammar + reviewGrammar === 0
  };
};

/**
 * 通知和首页共用的一句话。
 * 只说**还差多少**,不说已经做了多少——提醒的作用是让人现在去做,不是发奖状。
 */
export const shortfallText = (shortfall: Shortfall): string => {
  if (shortfall.clear) return "今天的最低量已经做完了";
  const parts: string[] = [];
  if (shortfall.reviewWords > 0) parts.push(`复习 ${shortfall.reviewWords}`);
  if (shortfall.newWords > 0) parts.push(`新词 ${shortfall.newWords}`);
  if (shortfall.reviewGrammar > 0) parts.push(`语法复习 ${shortfall.reviewGrammar}`);
  if (shortfall.newGrammar > 0) parts.push(`新语法 ${shortfall.newGrammar}`);
  return `还差 ${parts.join(" · ")}`;
};
