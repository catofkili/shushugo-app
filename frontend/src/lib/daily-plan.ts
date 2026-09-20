/**
 * 每日学习量：一份状态、三个入口（圆环 / 数字表单 / 备考一键，docs/MIXED_STUDY_PLAN.md 第 3 节）。
 *
 * 状态就是 studyPreferences 里那几个字段，这里只是把它们按「四种卡 × 新学 / 复习」摆成一个视图，
 * 再配上圆环要的两样东西：各类型的池子（段长按 √池子压缩）和建议下限。
 *
 * 复习那一半：单词走 reviewCap（0 = 自动、-1 = 不限、n = 上限），另外三种各自一个 cap（0 = 到期全出）。
 */
import { defaultStudyPreferences, getStudyPreferences, saveStudyPreferences, REVIEW_CAP_UNLIMITED, type StudyPreferences } from "./studyPreferences";
import { getJlptPlanStatus } from "./jlpt/status";
import { levelsInScope, CONSOLIDATION_DAYS, JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { firstValue, rowsFor, studyDayEnd } from "./study-core";
import { kanjiCharPool } from "./kanji-char-cards";
import { confusionCardPool } from "./confusion-cards";
import { dailyReviewCap } from "./review-budget";

export type PlanKind = "words" | "grammar" | "kanji" | "confusion";
export const PLAN_KINDS: PlanKind[] = ["words", "grammar", "kanji", "confusion"];
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
}

const LEVEL_RANK: Record<string, number> = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };

const amortize = (remaining: number, days: number) => (remaining <= 0 ? 0 : Math.ceil(remaining / Math.max(1, days)));

const wordDueCount = () => firstValue<number>(
  "SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count > 0 AND (fsrs_due IS NULL OR fsrs_due <= ?)",
  [studyDayEnd().toISOString()], 0
);

const grammarPools = (target: JlptTarget) => {
  const levels = levelsInScope(target).map((level) => `'${level}'`).join(", ");
  return {
    due: firstValue<number>(`
      SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id = p.grammar_id
      WHERE g.level IN (${levels}) AND p.known_forever = 0 AND p.seen_count > 0 AND p.fsrs_due IS NOT NULL AND p.fsrs_due <= ?
    `, [studyDayEnd().toISOString()], 0),
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

export const dailyPlanView = (prefs: StudyPreferences = getStudyPreferences()): DailyPlanView => {
  const status = getJlptPlanStatus();
  const target = prefs.jlptTarget;
  const rank = LEVEL_RANK[target] ?? 2;
  const intakeDays = Math.max(status.plan.daysLeft - CONSOLIDATION_DAYS, 0);
  const wordDue = wordDueCount();
  const grammar = grammarPools(target);
  const kanji = kanjiCharPool(rank);
  const confusion = confusionCardPool(rank);
  const pick = (cap: number, due: number) => (cap > 0 ? Math.min(cap, due) : due);
  const segments: PlanSegment[] = [
    {
      kind: "words", label: PLAN_LABELS.words,
      fresh: prefs.dailyGoal, review: wordReviewCount(prefs.reviewCap, wordDue),
      pool: { due: wordDue, unseen: status.coverage.words.total - status.coverage.words.seen },
      suggest: { fresh: status.plan.newWords, review: wordDue }
    },
    {
      kind: "grammar", label: PLAN_LABELS.grammar,
      fresh: prefs.grammarDailyGoal, review: pick(prefs.grammarReviewCap, grammar.due),
      pool: grammar,
      suggest: { fresh: status.plan.newGrammar, review: grammar.due }
    },
    {
      kind: "kanji", label: PLAN_LABELS.kanji,
      fresh: prefs.kanjiDailyGoal, review: pick(prefs.kanjiReviewCap, kanji.due),
      pool: kanji,
      suggest: { fresh: intakeDays > 0 ? amortize(kanji.unseen, intakeDays) : 0, review: kanji.due }
    },
    {
      kind: "confusion", label: PLAN_LABELS.confusion,
      fresh: prefs.confusionDailyGoal, review: pick(prefs.confusionReviewCap, confusion.due),
      pool: confusion,
      suggest: { fresh: intakeDays > 0 ? amortize(confusion.unseen, intakeDays) : 0, review: confusion.due }
    }
  ];
  const total = segments.reduce((sum, segment) => sum + segment.fresh + segment.review, 0);
  const minutes = Math.round(segments.reduce((sum, segment) => sum + (segment.fresh + segment.review) * SECONDS_PER_CARD[segment.kind], 0) / 60);
  return { total, segments, daysLeft: status.plan.daysLeft, minutes };
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

/** 一键安排：复习 = 今天到期的全部，新学 = 平时的额度。 */
export const arrangedPlan = (view: DailyPlanView): Record<PlanKind, { fresh: number; review: number }> => {
  const fresh = baselineFresh();
  return Object.fromEntries(view.segments.map((segment) => [segment.kind, { fresh: fresh[segment.kind], review: segment.pool.due }])) as Record<PlanKind, { fresh: number; review: number }>;
};

/**
 * 圆环 / 表单改完写回。数字直接落进偏好，不做二次解释；单词复习 0 存成 1（0 在 reviewCap 里是「自动」）。
 * `standing` = 这是明确定的平时额度（表单 / 备考一键），顺手记成一键安排的基线。
 */
export const saveDailyPlan = (next: Record<PlanKind, { fresh: number; review: number }>, standing = false) => {
  const prefs = getStudyPreferences();
  if (standing) {
    try { localStorage.setItem(BASELINE_KEY, JSON.stringify(Object.fromEntries(PLAN_KINDS.map((kind) => [kind, next[kind].fresh])))); } catch { /* 存不下就用默认档 */ }
  }
  saveStudyPreferences({
    ...prefs,
    dailyGoal: next.words.fresh,
    reviewCap: Math.max(1, next.words.review),
    grammarDailyGoal: next.grammar.fresh,
    grammarReviewCap: Math.max(1, next.grammar.review),
    kanjiDailyGoal: next.kanji.fresh,
    kanjiReviewCap: Math.max(1, next.kanji.review),
    confusionDailyGoal: next.confusion.fresh,
    confusionReviewCap: Math.max(1, next.confusion.review)
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
  const rows = rowsFor(`
    SELECT w.jlpt_level AS level, SUM(p.seen_count > 0 OR p.known_forever = 1) AS seen, COUNT(*) AS total
    FROM progress p JOIN words w ON w.id = p.word_id GROUP BY w.jlpt_level
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
 * 剩余 = (现在, 目标] 那几级里没学过的；复习按今天到期的给。
 * 用时按 SECONDS_PER_CARD 固定值算，不看用户历史。
 */
export const examPreset = (current: JlptTarget | null, target: JlptTarget) => {
  const status = getJlptPlanStatus();
  const intakeDays = Math.max(status.plan.daysLeft - CONSOLIDATION_DAYS, 0);
  const currentRank = current ? JLPT_TARGETS.indexOf(current) : -1;
  const targetRank = JLPT_TARGETS.indexOf(target);
  const levels = JLPT_TARGETS.slice(currentRank + 1, targetRank + 1).map((level) => `'${level}'`).join(", ") || "''";
  const unseenWords = firstValue<number>(`
    SELECT COUNT(*) FROM progress p JOIN words w ON w.id = p.word_id
    WHERE w.jlpt_level IN (${levels}) AND p.seen_count = 0 AND p.known_forever = 0
  `, [], 0);
  const unseenGrammar = firstValue<number>(`
    SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id = p.grammar_id
    WHERE g.level IN (${levels}) AND p.seen_count = 0 AND p.known_forever = 0
  `, [], 0);
  const kanjiUnseen = firstValue<number>(
    "SELECT COUNT(*) FROM kanji_char_memory WHERE known_forever = 0 AND seen_count = 0 AND level_rank > ? AND level_rank <= ?",
    [currentRank, targetRank], 0
  );
  const confusionUnseen = firstValue<number>(
    "SELECT COUNT(*) FROM confusion_progress WHERE known_forever = 0 AND seen_count = 0 AND level_rank > ? AND level_rank <= ? AND group_key NOT IN (SELECT group_key FROM confusion_mastered)",
    [currentRank, targetRank], 0
  );
  const confusion = confusionCardPool(targetRank);
  const plan: Record<PlanKind, { fresh: number; review: number }> = {
    words: { fresh: Math.min(50, amortize(unseenWords, intakeDays)), review: wordDueCount() },
    grammar: { fresh: Math.min(12, amortize(unseenGrammar, intakeDays)), review: grammarPools(target).due },
    kanji: { fresh: Math.min(50, amortize(kanjiUnseen, intakeDays)), review: kanjiCharPool(targetRank).due },
    confusion: { fresh: Math.min(20, amortize(confusionUnseen, intakeDays)), review: confusion.due }
  };
  const minutes = Math.round(PLAN_KINDS.reduce((sum, kind) => sum + (plan[kind].fresh + plan[kind].review) * SECONDS_PER_CARD[kind], 0) / 60);
  return { plan, minutes, daysLeft: status.plan.daysLeft, intakeDays, remaining: { words: unseenWords, grammar: unseenGrammar, kanji: kanjiUnseen, confusion: confusionUnseen } };
};

export const applyExamPreset = (current: JlptTarget | null, target: JlptTarget) => {
  const preset = examPreset(current, target);
  const prefs = getStudyPreferences();
  saveStudyPreferences({ ...prefs, jlptTarget: target });
  saveDailyPlan(preset.plan, true);
  return preset;
};
