import { firstValue, studyDayEnd, today } from "../study-core";
import { ensureProgressInitialized } from "../word-api/bootstrap";
import { ensureGrammarProgressInitialized } from "../grammar-api";
import { getJlptPlanPreferences } from "../studyPreferences";
import { nextExamDate, parseExamDate } from "./exam-dates";
import {
  computeDailyMinimum,
  levelsInScope,
  shortfallOf,
  type DailyMinimum,
  type JlptTarget,
  type Shortfall,
  type TodayProgress
} from "./plan";

/**
 * 把库里的真实进度喂给 jlpt/plan.ts 的纯计算。
 *
 * 这一层只做取数,所有「该做多少」的判断都在 plan.ts 里——
 * 想改口径去改那边,顺便还有测试兜着。
 */

export interface JlptPlanStatus {
  enabled: boolean;
  target: JlptTarget;
  examDate: Date;
  /** 考期是自动算的还是用户手填的 */
  examDateSource: "auto" | "manual";
  plan: DailyMinimum;
  done: TodayProgress;
  shortfall: Shortfall;
  /** 覆盖进度:范围内学过的 / 总数 */
  coverage: {
    words: { seen: number; total: number };
    grammar: { seen: number; total: number };
  };
}

/** 范围内的等级条件。词表里无级别的都是基础词,一律算进最低那档的范围。 */
const wordLevelClause = (target: JlptTarget) => {
  const levels = levelsInScope(target).map((level) => `'${level}'`).join(", ");
  return `(w.jlpt_level IN (${levels}) OR w.jlpt_level IS NULL OR w.jlpt_level = '')`;
};

const grammarLevelClause = (target: JlptTarget) => {
  const levels = levelsInScope(target).map((level) => `'${level}'`).join(", ");
  return `g.level IN (${levels})`;
};

/** 本学习日的开始 = 上一个凌晨 4 点。比它还早到期的才算「积压」。 */
const studyDayStart = (current = new Date()): Date => {
  const start = studyDayEnd(current);
  start.setDate(start.getDate() - 1);
  return start;
};

export function getJlptPlanStatus(now = new Date()): JlptPlanStatus {
  ensureProgressInitialized();
  ensureGrammarProgressInitialized();

  const prefs = getJlptPlanPreferences();
  const target = prefs.target;
  const manual = prefs.examDate ? parseExamDate(prefs.examDate) : null;
  const examDate = manual ?? nextExamDate(now);

  const day = today(now);
  const dayEnd = studyDayEnd(now).toISOString();
  const dayStart = studyDayStart(now).toISOString();
  const words = wordLevelClause(target);
  const grammar = grammarLevelClause(target);

  const wordTotal = firstValue<number>(
    `SELECT COUNT(*) FROM words w WHERE ${words}`, [], 0
  );
  const wordUnseen = firstValue<number>(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${words} AND p.seen_count = 0 AND p.known_forever = 0
  `, [], 0);

  // 到期分两块:本学习日内到期的(今天的正常量)和更早就到期的(积压)。
  // fsrs_due IS NULL 也算到期——和 CLAUDE.md 里的口径保持一致。
  const wordFreshDue = firstValue<number>(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${words} AND p.seen_count > 0 AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR (p.fsrs_due <= ? AND p.fsrs_due >= ?))
  `, [dayEnd, dayStart], 0);
  const wordOverdue = firstValue<number>(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${words} AND p.seen_count > 0 AND p.known_forever = 0
      AND p.fsrs_due IS NOT NULL AND p.fsrs_due < ?
  `, [dayStart], 0);

  const grammarTotal = firstValue<number>(
    `SELECT COUNT(*) FROM grammar_points g WHERE ${grammar}`, [], 0
  );
  const grammarUnseen = firstValue<number>(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${grammar} AND p.seen_count = 0 AND p.known_forever = 0
  `, [], 0);
  const grammarFreshDue = firstValue<number>(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${grammar} AND p.seen_count > 0 AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR (p.fsrs_due <= ? AND p.fsrs_due >= ?))
  `, [dayEnd, dayStart], 0);
  const grammarOverdue = firstValue<number>(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${grammar} AND p.seen_count > 0 AND p.known_forever = 0
      AND p.fsrs_due IS NOT NULL AND p.fsrs_due < ?
  `, [dayStart], 0);

  // 今天做过的:第一次见到的算新,见过的算复习。
  // 用 reviews 表而不是 stage1_tasks——任务表会被配额裁剪重排,
  // 而「今天到底答了什么」只有答题记录说了算。
  const newWordsDone = firstValue<number>(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN words w ON w.id = r.word_id
    WHERE r.reviewed_on = ? AND ${words}
      AND NOT EXISTS (
        SELECT 1 FROM reviews earlier
        WHERE earlier.word_id = r.word_id AND earlier.reviewed_on < ?
      )
  `, [day, day], 0);
  const wordsAnsweredToday = firstValue<number>(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN words w ON w.id = r.word_id
    WHERE r.reviewed_on = ? AND ${words}
  `, [day], 0);

  const newGrammarDone = firstValue<number>(`
    SELECT COUNT(DISTINCT r.grammar_id)
    FROM grammar_reviews r
    JOIN grammar_points g ON g.id = r.grammar_id
    WHERE r.reviewed_on = ? AND ${grammar}
      AND NOT EXISTS (
        SELECT 1 FROM grammar_reviews earlier
        WHERE earlier.grammar_id = r.grammar_id AND earlier.reviewed_on < ?
      )
  `, [day, day], 0);
  const grammarAnsweredToday = firstValue<number>(`
    SELECT COUNT(DISTINCT r.grammar_id)
    FROM grammar_reviews r
    JOIN grammar_points g ON g.id = r.grammar_id
    WHERE r.reviewed_on = ? AND ${grammar}
  `, [day], 0);

  const plan = computeDailyMinimum({
    today: now,
    examDate,
    unseenWords: wordUnseen,
    unseenGrammar: grammarUnseen,
    freshDueWords: wordFreshDue,
    overdueWords: wordOverdue,
    freshDueGrammar: grammarFreshDue,
    overdueGrammar: grammarOverdue
  });

  const done: TodayProgress = {
    newWordsDone,
    reviewWordsDone: Math.max(wordsAnsweredToday - newWordsDone, 0),
    newGrammarDone,
    reviewGrammarDone: Math.max(grammarAnsweredToday - newGrammarDone, 0)
  };

  return {
    enabled: prefs.enabled,
    target,
    examDate,
    examDateSource: manual ? "manual" : "auto",
    plan,
    done,
    shortfall: shortfallOf(plan, done),
    coverage: {
      words: { seen: wordTotal - wordUnseen, total: wordTotal },
      grammar: { seen: grammarTotal - grammarUnseen, total: grammarTotal }
    }
  };
}
