import type { WordCard } from "../../types/vocabulary";
import { firstValue, getState, persistSoon, rowsFor, setState, studyDayEnd, today } from "../study-core";
import { fatigueDetected } from "../review-budget";
import { rowObjectToCard } from "../models/word-card";

const DAILY_REVIEW_STATE_KEY = "daily_review_v1";

const reviewWasTriggeredToday = (): boolean => {
  const raw = getState(DAILY_REVIEW_STATE_KEY, "");
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { studyDate?: string; triggered?: boolean };
    return parsed.studyDate === today() && parsed.triggered === true;
  } catch {
    return false;
  }
};

export const hasDailyReviewTriggered = (): boolean => reviewWasTriggeredToday();

export const markDailyReviewTriggered = (): void => {
  setState(DAILY_REVIEW_STATE_KEY, JSON.stringify({ studyDate: today(), triggered: true }));
  persistSoon();
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

export const shouldStartDailyReview = (): boolean => {
  if (reviewWasTriggeredToday()) return false;
  const day = today();
  // 疲劳时不要再打开一个高强度的回顾循环,让普通学习流自然收尾。
  if (fatigueDetected(day)) return false;
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
  return progress >= 0.6 && progress <= 0.8 && dailyReviewCandidateCount() >= 4;
};

export const pickDailyReviewNext = (excludedIds: Set<number> = new Set()): WordCard | null => {
  const row = candidateRows(excludedIds)[0];
  return row ? rowObjectToCard(row) : null;
};
