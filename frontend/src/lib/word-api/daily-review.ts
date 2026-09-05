import type { WordCard } from "../../types/vocabulary";
import { firstValue, getState, persistSoon, rowsFor, setState, studyDayEnd, today } from "../study-core";
import { fatigueDetected } from "../review-budget";
import { rowObjectToCard } from "../models/word-card";

const DAILY_REVIEW_STATE_KEY = "daily_review_v1";

interface DailyReviewState {
  studyDate?: string;
  /** 今天已经开过一次回顾区(一天只开一次) */
  triggered?: boolean;
  /** 今天的完成度进过 60%~80% 的窗口 = 已上膛,等下一次「忘记」开火 */
  armed?: boolean;
}

const readReviewState = (): DailyReviewState => {
  const raw = getState(DAILY_REVIEW_STATE_KEY, "");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as DailyReviewState;
    return parsed.studyDate === today() ? parsed : {};
  } catch {
    return {};
  }
};

const writeReviewState = (next: DailyReviewState): void => {
  setState(DAILY_REVIEW_STATE_KEY, JSON.stringify({ ...next, studyDate: today() }));
  persistSoon();
};

const reviewWasTriggeredToday = (): boolean => readReviewState().triggered === true;

export const hasDailyReviewTriggered = (): boolean => reviewWasTriggeredToday();

export const markDailyReviewTriggered = (): void => {
  writeReviewState({ ...readReviewState(), triggered: true });
};

const currentReviewCountSql = `(
  SELECT COUNT(*)
  FROM reviews today_reviews
  WHERE today_reviews.word_id = t.word_id
    AND today_reviews.reviewed_on = ?
    AND today_reviews.direction = 'forward'
)`;

const unresolvedSql = `(p.known_forever = 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?))`;

const candidateRows = (excludedIds: Set<number> = new Set()) => {
  const day = today();
  const dayEnd = studyDayEnd().toISOString();
  const rows = rowsFor(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_due,
      p.fsrs_state,
      p.fsrs_steps,
      p.fsrs_reps,
      p.fsrs_lapses,
      ${currentReviewCountSql} AS today_seen_count,
      COALESCE(n.note, '') AS note
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ?
      AND ${unresolvedSql}
      AND ${currentReviewCountSql} >= 4
    ORDER BY today_seen_count DESC, COALESCE(p.fsrs_lapses, 0) DESC, p.fsrs_due ASC, w.id ASC
  `, [day, day, dayEnd, day]);
  return rows.filter((row) => !excludedIds.has(Number(row.id)));
};

export const dailyReviewCandidateCount = (excludedIds: Set<number> = new Set()): number =>
  candidateRows(excludedIds).length;

/**
 * 今日任务完成度落在 60%~80%：太早还没积够反复卡住的词，太晚该收尾了。
 *
 * ⚠️ 这个比例**只可能在答对的那一下往上跳** —— completed 的判据是「毕业」，
 * 而忘记/模糊会把 due 留在今天，一个都不加。所以它只用来「上膛」，不直接开火：
 * 直接开火的话，红色横幅永远紧跟着一次「认识」弹出来，而它说的是错题。
 */
const completionInTriggerWindow = (day: string): boolean => {
  const total = firstValue<number>(
    "SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?",
    [day],
    0
  );
  if (total <= 0) return false;
  const completed = firstValue<number>(`
    SELECT COUNT(DISTINCT t.word_id)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
  `, [day, studyDayEnd().toISOString()], 0);
  const progress = Number(completed) / Number(total);
  return progress >= 0.6 && progress <= 0.8;
};

/**
 * 每答完一题问一次：现在该开当日错题回顾了吗。
 *
 * 两段式：完成度进过 60%~80% 的窗口先**上膛**（写进 app_state，熬得过刷新），
 * 之后**下一次「忘记」**才开火。上膛这一下本身就是忘记的话，当场开火。
 * 上了膛就一直算数 —— 后面被一串「认识」推过 80% 也不撤销，
 * 不然「今天卡住的词」正好在最该回顾的时候被答对推没了。
 */
export const shouldStartDailyReview = (justForgot: boolean): boolean => {
  if (reviewWasTriggeredToday()) return false;
  const day = today();
  // 疲劳时不要再打开一个高强度的回顾循环,让普通学习流自然收尾。
  if (fatigueDetected(day)) return false;
  const state = readReviewState();
  if (!state.armed) {
    if (!completionInTriggerWindow(day)) return false;
    writeReviewState({ ...state, armed: true });
  }
  if (!justForgot) return false;
  return dailyReviewCandidateCount() >= 4;
};

export const pickDailyReviewNext = (excludedIds: Set<number> = new Set()): WordCard | null => {
  const row = candidateRows(excludedIds)[0];
  return row ? rowObjectToCard(row) : null;
};
