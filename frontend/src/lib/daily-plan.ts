import { collocationWordSql, newWordEligibleSql, wordLearningScopeSql, wordStartedSql } from "./word-learning-scope";
/**
 * 每日学习量：一份状态、三个入口（圆环 / 数字表单 / 备考一键，docs/MIXED_STUDY_PLAN.md 第 3 节）。
 *
 * 状态就是 studyPreferences 里那几个字段，这里只是把它们按「四种卡 × 新学 / 复习」摆成一个视图，
 * 再配上圆环要的两样东西：各类型的池子（段长按 √池子压缩）和建议下限。
 *
 * 复习那一半：单词走 reviewCap（0 = 自动、-1 = 不限、n = 上限）；另外三种各自一个 cap（0 = 该类默认上限、-1 = 不出复习，见 planReviewLimit）。
 */
import { defaultStudyPreferences, getEffectiveStudyPreferences, getStudyPreferences, kanaGatePending, saveStudyPreferences, PLAN_REVIEW_DISABLED, REVIEW_CAP_UNLIMITED, type StudyPreferences } from "./studyPreferences";
import { getJlptPlanStatus } from "./jlpt/status";
import { levelsInScope, JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { firstValue, rowsFor, studyDayEnd } from "./study-core";
import { kanjiCharPool, kanjiCharPriorCount } from "./kanji-char-cards";
import { confusionCardPool, confusionPriorCount } from "./confusion-cards";
import { autoPlanReviewCap, dailyReviewCap, planReviewLimit, type PlanReviewKind } from "./review-budget";
import { plannedDueCount, WORD_FSRS } from "./fsrs-store";
import { forecastPriorReleases, priorIdsForEntity, pendingPriorSql, PRIOR_ENTITIES } from "./prior-pacing";
import { grammarReviewPool, PLAN_GRAMMAR_LEVEL } from "./grammar-quiz";
import { getDailyReliefProgress } from "./word-api/daily-relief";
import { getDailyTailProgress } from "./word-api/daily-tail";
import { effectiveStartingLevel, getLevelPlanSettings } from "./level-plan";
import { predictLoad, type LoadKind } from "./plan/load-model";
import { previewLevelPlan } from "./plan/content-matrix";
import { parseExamDate } from "./jlpt/exam-dates";
import { kanaComplete } from "./kana-progress";
import { ensureProgressInitialized } from "./word-api/bootstrap";

export type PlanKind = "words" | "grammar" | "kanji" | "confusion";
// keep = [那一刻的复习显示值, 那一刻该存的 cap]：保存时 review 仍等于 keep[0]，就原样存回 keep[1]。
// 一键安排用它表达「回自动档」（cap=0），撤回栈用它带回当时的 cap（stampPlanCaps）。
// 带着这个字段再手动改 review，数字对不上就按手动值存，不会误存成旧 cap。它不落进偏好或云数据。
type DailyPlan = Record<PlanKind, { fresh: number; review: number; keep?: [number, number] }>;
export const PLAN_KINDS: PlanKind[] = ["words", "grammar", "kanji", "confusion"];
export const hasPendingPlanTotal = (draft: string | null, total: number): boolean => (
  draft !== null && Number(draft) !== total
);
export const PLAN_LABELS: Record<PlanKind, string> = { words: "单词", grammar: "语法", kanji: "汉字", confusion: "辨析" };

/** 每张卡按标准节奏要多少秒。⚠️ 不拿用户自己的数据算 —— 作者边看视频边学，效率不代表标准。 */
export const SECONDS_PER_CARD: Record<PlanKind, number> = { words: 12, grammar: 25, kanji: 10, confusion: 40 };

export interface PlanSegment {
  kind: PlanKind;
  label: string;
  fresh: number;
  review: number;
  /** 今天能给的：到期数 + 目标等级内没学过的 */
  pool: { due: number; unseen: number };
  /** 建议下限：复习 ≥ 到期数；新学 ≥ 剩余 ÷ 距考试可进新内容的天数 */
  suggest: { fresh: number; review: number };
}

export interface DailyPlanView {
  total: number;
  segments: PlanSegment[];
  daysLeft: number;
  /** 按 SECONDS_PER_CARD 算的预计用时（分钟） */
  minutes: number;
  /** 单词复习那段里掺着的减负 + 压轴数（写回时要减掉的正是渲染时加上的这一份） */
  wordExtras: number;
  /** 渲染时已加上的先验验证名额，改圆环写回普通复习 cap 时要减掉。 */
  priorExtras?: Partial<Record<PlanKind, number>>;
}

const LEVEL_RANK: Record<string, number> = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };

const amortize = (remaining: number, days: number) => (remaining <= 0 ? 0 : Math.ceil(remaining / Math.max(1, days)));

/** 可参与今日计划的全部到期词（先验仍限速）；显示复习数时再套普通复习上限。 */
const wordDueCount = () => plannedDueCount(studyDayEnd());

const grammarPools = (target: JlptTarget) => {
  const levels = levelsInScope(target).map((level) => `'${level}'`).join(", ");
  return {
    due: grammarReviewPool(PLAN_GRAMMAR_LEVEL).due,
    unseen: firstValue<number>(`
      SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id = p.grammar_id
      WHERE g.level IN (${levels}) AND p.known_forever = 0 AND p.seen_count = 0
    `, [], 0)
  };
};

/** 单词复习那一半现在是多少：cap 的三种取值翻译成一个数（自动 / 不限 → 按今天实际会给的算）。 */
const wordReviewCount = (cap: number, due: number) => {
  if (cap === REVIEW_CAP_UNLIMITED) return due;
  const limit = dailyReviewCap(cap);
  return Math.min(due, limit);
};

/**
 * 减负卡（开头）+ 压轴卡（结尾）：不在 stage1_tasks 里，但今天确实会出现。
 * **圆环上的数就是最终数字**（用户定的）：单词那段把这两批算进去显示，写回时再减掉，
 * 这样圆环、大卡、小路三处是同一个数。今天还没生成时是 0，生成后当天不变。
 */
const wordExtras = () => getDailyReliefProgress().total + getDailyTailProgress().total;
const pick = (cap: number, due: number, kind: PlanReviewKind) => Math.min(due, planReviewLimit(cap, kind));

/** 级别起点只补足旧级别的先验；目标级别以上已有的真实学习/批量认识记录必须从今日剩余量中扣掉。 */
export const remainingPlanWords = (startingLevel: string, target: JlptTarget, familiarity?: { words: number }, includeOptional?: boolean) => {
  if (startingLevel === "beyond") return 0;
  const startRank = JLPT_TARGETS.indexOf(startingLevel as JlptTarget);
  const targetRank = JLPT_TARGETS.indexOf(target);
  const firstRank = startRank < 0 ? 0 : startRank + (familiarity?.words === 0 ? 0 : 1);
  const levels = JLPT_TARGETS.slice(firstRank, targetRank + 1);
  if (!levels.length) return 0;
  ensureProgressInitialized();
  const inLevels = levels.map((level) => `'${level}'`).join(", ");
  const baseWords = firstRank === 0 ? " OR w.jlpt_level IS NULL OR w.jlpt_level = ''" : "";
  return firstValue<number>(`
    SELECT COUNT(*) FROM words w
    LEFT JOIN progress p ON p.word_id = w.id
    WHERE (w.jlpt_level IN (${inLevels})${baseWords})
      AND NOT ${collocationWordSql()}
      AND ${newWordEligibleSql("w", "p", includeOptional)}
  `, [], 0);
};

/** 每次打开/更新计划都按当前真实进度估算，旧起点只决定先验覆盖到哪一级。 */
export const previewCurrentLevelPlan = (input: Parameters<typeof previewLevelPlan>[0]) =>
  previewLevelPlan({
    ...input,
    remainingWords: remainingPlanWords(input.startingLevel, input.target, input.familiarity, input.includeOptionalExpressions)
  });

/** 自动档会给的复习数：普通到期套各自的自动上限，先验 / 减负 / 压轴另算。 */
const autoReview = (kind: PlanKind, due: number, extra: number) =>
  Math.min(due - extra, kind === "words" ? dailyReviewCap(0) : autoPlanReviewCap(kind)) + extra;

export const dailyPlanView = (prefs: StudyPreferences = getEffectiveStudyPreferences()): DailyPlanView => {
  const status = getJlptPlanStatus();
  const target = prefs.jlptTarget;
  const rank = LEVEL_RANK[target] ?? 2;
  const intakeDays = status.plan.intakeDaysLeft;
  const extras = wordExtras();
  const wordDue = wordDueCount() + extras;
  const grammar = grammarPools(target);
  const kanji = kanjiCharPool(rank);
  const confusion = confusionCardPool(rank);
  const priorExtras = { words: priorIdsForEntity(WORD_FSRS).length, grammar: grammarReviewPool(PLAN_GRAMMAR_LEVEL).prior,
    kanji: kanjiCharPriorCount(), confusion: confusionPriorCount() };
  const segments: PlanSegment[] = [
    {
      kind: "words", label: PLAN_LABELS.words,
      fresh: kanaGatePending() ? 0 : prefs.dailyGoal, review: wordReviewCount(prefs.reviewCap, wordDue - extras - priorExtras.words) + extras + priorExtras.words,
      pool: { due: wordDue, unseen: remainingPlanWords("kana", target, undefined, prefs.includeOptionalExpressions) },
      // 建议复习数 = 自动档会给的数，不是今天到期的全部（2026-11-13）。原来写的是全部到期：
      // 作者库到期 1,981 时面板显示「复习 150（建议 ≥ 1981）」并标「偏少」，点「补到建议值」
      // 就把 1981 写成长期固定上限 —— 和一键安排把 621 写死是同一个坑的另一个入口。四段同理。
      suggest: { fresh: status.plan.newWords, review: autoReview("words", wordDue, extras + priorExtras.words) }
    },
    {
      kind: "grammar", label: PLAN_LABELS.grammar,
      fresh: prefs.grammarDailyGoal, review: grammarReviewPool(PLAN_GRAMMAR_LEVEL, prefs.grammarReviewCap).review,
      pool: grammar,
      suggest: { fresh: status.plan.newGrammar, review: autoReview("grammar", grammar.due, priorExtras.grammar) }
    },
    {
      kind: "kanji", label: PLAN_LABELS.kanji,
      fresh: prefs.kanjiDailyGoal, review: pick(prefs.kanjiReviewCap, kanji.due - priorExtras.kanji, "kanji") + priorExtras.kanji,
      pool: kanji,
      suggest: { fresh: intakeDays > 0 ? amortize(kanji.unseen, intakeDays) : 0, review: autoReview("kanji", kanji.due, priorExtras.kanji) }
    },
    {
      kind: "confusion", label: PLAN_LABELS.confusion,
      fresh: prefs.confusionDailyGoal, review: pick(prefs.confusionReviewCap, confusion.due - priorExtras.confusion, "confusion") + priorExtras.confusion,
      pool: confusion,
      suggest: { fresh: intakeDays > 0 ? amortize(confusion.unseen, intakeDays) : 0, review: autoReview("confusion", confusion.due, priorExtras.confusion) }
    }
  ];
  const total = segments.reduce((sum, segment) => sum + segment.fresh + segment.review, 0);
  const minutes = Math.round(segments.reduce((sum, segment) => sum + (segment.fresh + segment.review) * SECONDS_PER_CARD[segment.kind], 0) / 60);
  return { total, segments, daysLeft: status.plan.daysLeft, minutes, wordExtras: extras, priorExtras };
};

type Fresh = Record<PlanKind, number>;
const BASELINE_KEY = "mn-daily-plan-baseline";
const freshOf = (prefs: StudyPreferences): Fresh => ({
  words: prefs.dailyGoal, grammar: prefs.grammarDailyGoal, kanji: prefs.kanjiDailyGoal, confusion: prefs.confusionDailyGoal
});
/**
 * 「一键安排」用的基线 = **我平时的新学额度**：只有数字表单和备考一键这种明确写数字的动作才更新它，
 * 拖圆环是「今天临时挪一下」，不算。没定过就是默认档。用户原话：当天该复习的 + 我本来的新学量。
 */
const baselineFresh = (): Fresh => {
  try {
    const stored = JSON.parse(localStorage.getItem(BASELINE_KEY) ?? "null") as Fresh | null;
    if (stored && PLAN_KINDS.every((kind) => Number.isFinite(stored[kind]))) return stored;
  } catch { /* 没有或坏了：当没有 */ }
  return freshOf(defaultStudyPreferences);
};

/** 一键安排：复习回到各自自动档，新学 = 平时的额度。先验 / 减负 / 压轴仍另算。 */
export const arrangedPlan = (view: DailyPlanView): DailyPlan => {
  const fresh = baselineFresh();
  return Object.fromEntries(view.segments.map(({ kind, pool }) => {
    const review = autoReview(kind, pool.due, (view.priorExtras?.[kind] ?? 0) + (kind === "words" ? view.wordExtras : 0));
    return [kind, { fresh: fresh[kind], review, keep: [review, 0] }];
  })) as DailyPlan;
};

/**
 * 压进撤回栈之前给快照带上**此刻**四类的 cap，撤回时 saveDailyPlan 原样写回。
 * 没有这一步的话撤回只还原了圆环上的数字：cap=400 时点一键安排（存成 0）再撤回，圆环回到 400，
 * 存着的 cap 仍是 0，明天实际只给自动档的 150（2026-11-13 审查复现；改一键安排之前撤回同样不还原 cap，
 * 只是那时没人注意）。⚠️ 必须在落盘**之前**调用，落盘之后读到的已经是新 cap。
 */
export const stampPlanCaps = <T extends DailyPlan>(plan: T): T => {
  const prefs = getStudyPreferences();
  const caps = [prefs.reviewCap, prefs.grammarReviewCap, prefs.kanjiReviewCap, prefs.confusionReviewCap];
  return Object.fromEntries(PLAN_KINDS.map((kind, index) => [kind, { ...plan[kind], keep: [plan[kind].review, caps[index]] }])) as T;
};

/**
 * 圆环 / 表单改完写回。手动数字直接落进偏好；单词复习那段先减掉减负 + 压轴再存。
 * 一键安排 / 撤回快照显式携带 keep，review 与 keep[0] 匹配时才把 cap 存成 keep[1]（见 DailyPlan 类型上的说明）。
 * ⚠️ **复习数没动的段，cap 原样留着**：显示的是 min(到期, cap)，不比对就写回等于把「上限 400」
 * 悄悄改成「今天到期的 354」，明天到期多了也只给 354；三种 0（默认上限 / 自动）同理会被写死成一个数。
 * ⚠️ **「没动」比的是用户看到的那份 `shown`，不能在这里重算**（2026-09-22 修）：面板的数是挂载时算的，
 * 之后减负 / 压轴生成了、或答题让到期数掉下来了，重算出来的「显示值」就和圆环上那个不一样 ——
 * 于是拖别的段也会把单词 cap 写死成挂载时的到期数（用户的 400 很可能就是这样变成 341 的），
 * 拖单词段则多减一份圆环上根本没加过的 extras。
 * `standing` = 这是明确定的平时额度（表单 / 备考一键），顺手记成一键安排的基线。
 */
export const saveDailyPlan = (next: DailyPlan, standing = false, shown: DailyPlanView = dailyPlanView()) => {
  const prefs = getStudyPreferences();
  if (standing) {
    try { localStorage.setItem(BASELINE_KEY, JSON.stringify(Object.fromEntries(PLAN_KINDS.map((kind) => [kind, next[kind].fresh])))); } catch { /* 存不下就用默认档 */ }
  }
  const shownOf = (kind: PlanKind) => shown.segments.find((segment) => segment.kind === kind)?.review ?? 0;
  const keepOr = (kind: PlanKind, current: number) => {
    const item = next[kind];
    if (item.review === item.keep?.[0]) return item.keep[1];
    if (item.fresh + item.review === 0) return PLAN_REVIEW_DISABLED;
    if (item.review === shownOf(kind)) return current;
    const ordinary = item.review - (shown.priorExtras?.[kind] ?? 0);
    return ordinary > 0 ? ordinary : PLAN_REVIEW_DISABLED;
  };
  saveStudyPreferences({
    ...prefs,
    dailyGoal: next.words.fresh,
    reviewCap: next.words.review === next.words.keep?.[0] ? next.words.keep[1] : next.words.review === shownOf("words") ? prefs.reviewCap : Math.max(1, next.words.review - shown.wordExtras - (shown.priorExtras?.words ?? 0)),
    grammarDailyGoal: next.grammar.fresh,
    grammarReviewCap: keepOr("grammar", prefs.grammarReviewCap),
    kanjiDailyGoal: next.kanji.fresh,
    kanjiReviewCap: keepOr("kanji", prefs.kanjiReviewCap),
    confusionDailyGoal: next.confusion.fresh,
    confusionReviewCap: keepOr("confusion", prefs.confusionReviewCap)
  });
};

/**
 * 圆环上的段长 = log(1 + 数量)。**数字是真的，长度是压过的**：517 词 / 31 语法 / 8 汉字 / 19 辨析
 * 按原比例是 90% / 5% / 1% / 3%，三个滑钮挤成一堆；log 后约 42% / 23% / 15% / 20%，最小那段也有地方可拖。
 * （第一版用 1/√池子 做权重，单词一多还是占八成 —— 用户当场报的。）数量 0 → 长度 0，滑钮重合。
 */
export const segmentLength = (count: number) => Math.log1p(Math.max(0, count));

/**
 * 「现在 N几」从数据算，不让用户猜：从 N5 往上，一级里学过的词过半就算过了这一级，
 * 第一级不过半就停。一个词没学过 → null（从零开始，五级全算剩余）。
 * 阈值 0.5 是「这一级的词大部分见过」的最松说法；作者库 N5 93% / N4 82% / N3 56% / N2 3% → N3。
 */
export const learnedLevel = (): JlptTarget | null => {
  if (getLevelPlanSettings()) return effectiveStartingLevel();
  const rows = rowsFor(`
    SELECT w.jlpt_level AS level, SUM(${wordStartedSql()} OR p.known_forever = 1) AS seen, COUNT(*) AS total
    FROM progress p JOIN words w ON w.id = p.word_id WHERE ${wordLearningScopeSql()} GROUP BY w.jlpt_level
  `);
  const ratio = new Map(rows.map((row) => [String(row.level), Number(row.seen) / Math.max(1, Number(row.total))]));
  let current: JlptTarget | null = null;
  for (const level of JLPT_TARGETS) {
    if ((ratio.get(level) ?? 0) < 0.5) break;
    current = level;
  }
  return current;
};

/**
 * 备考一键：现在 N几（null = 从零）、下次考 N几 → 按标准量算每日新学。
 * 剩余 = 目标范围内实际没学过的；自报本级熟悉度为 0 时本级也要进新学。
 * 用时按 SECONDS_PER_CARD 固定值算，不看用户历史。
 */
export const examPreset = (target: JlptTarget) => {
  const status = getJlptPlanStatus();
  const settings = getLevelPlanSettings();
  const expected = settings ? previewCurrentLevelPlan({
    startingLevel: settings.startingLevel,
    familiarity: settings.familiarity,
    target,
    examDate: status.examDate,
    startedOn: parseExamDate(settings.startedOn) ?? undefined,
    kanaCompleted: settings.startingLevel === "kana-none" && kanaComplete()
  }) : null;
  const intakeDays = expected?.intakeDays ?? status.plan.intakeDaysLeft;
  const targetRank = JLPT_TARGETS.indexOf(target);
  const levels = JLPT_TARGETS.slice(0, targetRank + 1).map((level) => `'${level}'`).join(", ");
  const unseenWords = expected?.content.words ?? firstValue<number>(`
    SELECT COUNT(*) FROM progress p JOIN words w ON w.id = p.word_id
    WHERE w.jlpt_level IN (${levels}) AND NOT ${collocationWordSql()} AND ${newWordEligibleSql()}
  `, [], 0);
  const unseenGrammar = expected?.content.grammar ?? firstValue<number>(`
    SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id = p.grammar_id
    WHERE g.level IN (${levels}) AND p.seen_count = 0 AND p.known_forever = 0
  `, [], 0);
  const kanjiUnseen = expected?.content.kanji ?? firstValue<number>(
    "SELECT COUNT(*) FROM kanji_char_memory WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ?",
    [targetRank], 0
  );
  const confusionUnseen = expected?.content.confusion ?? firstValue<number>(
    "SELECT COUNT(*) FROM confusion_progress WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ? AND group_key NOT IN (SELECT group_key FROM confusion_mastered)",
    [targetRank], 0
  );
  const confusion = confusionCardPool(targetRank);
  const plan: Record<PlanKind, { fresh: number; review: number }> = {
    // 和 arrangedPlan 一样带上 extras：写回会减掉它，落下来的 cap 才是「今天该复习的」本身
    words: { fresh: expected?.daily.words ?? Math.min(50, amortize(unseenWords, intakeDays)), review: wordDueCount() + wordExtras() },
    grammar: { fresh: expected?.daily.grammar ?? Math.min(12, amortize(unseenGrammar, intakeDays)), review: grammarPools(target).due },
    kanji: { fresh: expected?.daily.kanji ?? Math.min(50, amortize(kanjiUnseen, intakeDays)), review: kanjiCharPool(targetRank).due },
    confusion: { fresh: expected?.daily.confusion ?? Math.min(20, amortize(confusionUnseen, intakeDays)), review: confusion.due }
  };
  const minutes = Math.round(PLAN_KINDS.reduce((sum, kind) => sum + (plan[kind].fresh + plan[kind].review) * SECONDS_PER_CARD[kind], 0) / 60);
  const dueTables: Record<LoadKind, string> = { words: "progress", grammar: "grammar_progress", kanji: "kanji_char_memory", confusion: "confusion_progress" };
  const ends = Array.from({ length: 8 * 7 }, (_, index) => {
    const end = studyDayEnd(); end.setDate(end.getDate() + index); return end;
  });
  const priorLoads = Object.fromEntries(PLAN_KINDS.map((kind) => [kind, forecastPriorReleases(kind, ends)])) as Record<PlanKind, number[]>;
  const existingDuePerWeek = Array.from({ length: 8 }, (_, index) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return Object.fromEntries((Object.keys(dueTables) as LoadKind[]).map((kind) => [kind, firstValue<number>(
      `SELECT COUNT(*) FROM ${dueTables[kind]} WHERE known_forever = 0 AND fsrs_due >= ? AND fsrs_due < ?
        AND NOT ${pendingPriorSql(kind, `${dueTables[kind]}.${PRIOR_ENTITIES[kind].idColumn}`)}`,
      [start.toISOString(), end.toISOString()], 0
    ) + priorLoads[kind].slice(index * 7, (index + 1) * 7).reduce((sum, value) => sum + value, 0)])) as Record<LoadKind, number>;
  });
  const load = predictLoad({
    dailyNew: Object.fromEntries(PLAN_KINDS.map((kind) => [kind, plan[kind].fresh])) as Record<LoadKind, number>,
    existingDuePerWeek,
    intakeDaysLeft: intakeDays,
    weeks: 8
  });
  return { plan, minutes, load, daysLeft: status.plan.daysLeft, intakeDays, remaining: { words: unseenWords, grammar: unseenGrammar, kanji: kanjiUnseen, confusion: confusionUnseen }, expected };
};

export const applyExamPreset = (target: JlptTarget) => {
  const preset = examPreset(target);
  const prefs = getStudyPreferences();
  saveStudyPreferences({ ...prefs, jlptTarget: target });
  saveDailyPlan(preset.plan, true);
  return preset;
};

/**
 * 「暂不备考」时的三档每日新内容量（2026-10-19 作者要）。没有考期就算不出「每天至少多少」，只能让用户挑强度；
 * 「标准」= 没设计划时的默认量（studyPreferences 的 defaultStudyPreferences）。复习上限不动，沿用当前设置。
 */
export type StudyIntensity = "light" | "normal" | "hard";
export const STUDY_INTENSITY: Record<StudyIntensity, { label: string } & Record<PlanKind, number>> = {
  light: { label: "轻松", words: 10, grammar: 2, kanji: 3, confusion: 2 },
  normal: { label: "标准", words: 15, grammar: 5, kanji: 5, confusion: 5 },
  hard: { label: "加把劲", words: 30, grammar: 8, kanji: 10, confusion: 8 }
};

export const applyStudyIntensity = (intensity: StudyIntensity) => {
  const shown = dailyPlanView();
  const reviewOf = (kind: PlanKind) => shown.segments.find((segment) => segment.kind === kind)?.review ?? 0;
  const plan = Object.fromEntries(PLAN_KINDS.map((kind) => [kind, { fresh: STUDY_INTENSITY[intensity][kind], review: reviewOf(kind) }])) as Record<PlanKind, { fresh: number; review: number }>;
  // review 原样传回 = saveDailyPlan 保留现有复习上限
  saveDailyPlan(plan, true, shown);
  return { plan };
};
