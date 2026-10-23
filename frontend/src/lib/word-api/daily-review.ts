import type { WordCard } from "../../types/vocabulary";
import { firstValue, getState, persistSoon, rowsFor, setState, studyDayEnd, today } from "../study-core";
import { fatigueDetected } from "../review-budget";
import { rowObjectToCard } from "../models/word-card";
export { wordCardById as getDailyReviewCard } from "../word-api";

export const DAILY_REVIEW_MIN_SEEN = 3;
const DAILY_REVIEW_STATE_KEY = "daily_review_v2";

interface DailyReviewState {
  studyDate: string;
  rounds: number;
  invites: number;
  lastRoundAnswerCount: number;
  snoozeUntilAnswerCount: number;
  declined: boolean;
}

const readReviewState = (): DailyReviewState => {
  const fresh: DailyReviewState = {
    studyDate: today(), rounds: 0, invites: 0, lastRoundAnswerCount: 0,
    snoozeUntilAnswerCount: 0, declined: false
  };
  try {
    const parsed = JSON.parse(getState(DAILY_REVIEW_STATE_KEY, "{}"));
    return parsed.studyDate === fresh.studyDate ? { ...fresh, ...parsed } : fresh;
  } catch {
    return fresh;
  }
};

const writeReviewState = (next: DailyReviewState): void => {
  setState(DAILY_REVIEW_STATE_KEY, JSON.stringify(next));
  persistSoon();
};

const todayAnswerCount = (): number => Number(firstValue<number>(
  "SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?", [today()], 0
));

const currentReviewCountSql = `(
  SELECT COUNT(*)
  FROM reviews today_reviews
  WHERE today_reviews.word_id = t.word_id
    AND today_reviews.reviewed_on = ?
    AND today_reviews.direction = 'forward'
)`;

const unresolvedSql = `(p.known_forever = 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?))`;

const candidateRows = () => {
  const day = today();
  const dayEnd = studyDayEnd().toISOString();
  return rowsFor(`
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
      AND ${currentReviewCountSql} >= ${DAILY_REVIEW_MIN_SEEN}
    ORDER BY today_seen_count DESC, COALESCE(p.fsrs_lapses, 0) DESC, p.fsrs_due ASC, w.id ASC
    LIMIT 8
  `, [day, day, dayEnd, day]);
};

export const dailyReviewCandidateCount = (): number => Number(firstValue<number>(`
  SELECT COUNT(*) FROM stage1_tasks t
  JOIN words w ON w.id = t.word_id
  JOIN progress p ON p.word_id = t.word_id
  WHERE t.reviewed_on = ? AND ${unresolvedSql}
    AND ${currentReviewCountSql} >= ${DAILY_REVIEW_MIN_SEEN}
`, [today(), studyDayEnd().toISOString(), today()], 0));

export const dailyReviewBatch = (): WordCard[] => candidateRows().map(rowObjectToCard);

export const shouldInviteDailyReview = (): boolean => {
  const state = readReviewState();
  // 小程序每题都会问，先用便宜的闸挡住，再查疲劳和逐词候选。
  if (state.declined || state.rounds >= 2) return false;
  const count = todayAnswerCount();
  if (count < state.snoozeUntilAnswerCount) return false;
  if (state.rounds === 1 && count - state.lastRoundAnswerCount < 30) return false;
  if (fatigueDetected()) return false;
  return dailyReviewCandidateCount() >= 5;
};

export const declineDailyReviewInvite = (): void => {
  const state = readReviewState();
  const invites = state.invites + 1;
  writeReviewState({ ...state, invites, declined: invites >= 2,
    snoozeUntilAnswerCount: invites >= 2 ? 0 : todayAnswerCount() + 20 });
};

export const startDailyReviewRound = (): void => {
  const state = readReviewState();
  writeReviewState({ ...state, rounds: state.rounds + 1, lastRoundAnswerCount: todayAnswerCount(),
    invites: 0, snoozeUntilAnswerCount: 0 });
};
