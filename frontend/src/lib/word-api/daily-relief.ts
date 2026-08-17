import type { WordCard } from "../../types/vocabulary";
import { notifyProgressUpdated } from "../progress-events";
import { rowObjectToCard } from "../models/word-card";
import { firstRow, persistSoon, rowsFor, setState, getState, today } from "../study-core";
import { ensureStage1Tasks } from "./stage1";

const RELIEF_STATE_KEY = "daily_relief_v1";
const MIN_RELIEF_WORDS = 6;
const MAX_RELIEF_WORDS = 12;

export interface DailyReliefState {
  studyDate: string;
  wordIds: number[];
  completed: number;
}

const emptyState = (studyDate = today()): DailyReliefState => ({
  studyDate,
  wordIds: [],
  completed: 0
});

const normalizeState = (value: unknown, studyDate: string): DailyReliefState => {
  if (!value || typeof value !== "object") return emptyState(studyDate);
  const candidate = value as Partial<DailyReliefState>;
  const wordIds = Array.isArray(candidate.wordIds)
    ? candidate.wordIds.map(Number).filter((id) => Number.isFinite(id))
    : [];
  const uniqueWordIds = Array.from(new Set(wordIds));
  return {
    studyDate,
    wordIds: uniqueWordIds,
    completed: Math.min(Math.max(Number(candidate.completed ?? 0), 0), uniqueWordIds.length)
  };
};

const readState = (studyDate = today()): DailyReliefState => {
  const raw = getState(RELIEF_STATE_KEY, "");
  if (!raw) return emptyState(studyDate);
  try {
    const parsed = JSON.parse(raw) as Partial<DailyReliefState>;
    if (parsed.studyDate !== studyDate) return emptyState(studyDate);
    return normalizeState(parsed, studyDate);
  } catch {
    return emptyState(studyDate);
  }
};

const writeState = (state: DailyReliefState): DailyReliefState => {
  setState(RELIEF_STATE_KEY, JSON.stringify(state));
  persistSoon();
  notifyProgressUpdated();
  return state;
};

type ReliefCandidate = { wordId: number; rememberedCount: number };

const reliefCandidates = (studyDate: string): ReliefCandidate[] => {
  const previousDate = new Date(`${studyDate}T12:00:00`);
  previousDate.setDate(previousDate.getDate() - 1);
  const yesterday = previousDate.toISOString().slice(0, 10);
  return rowsFor(`
    SELECT r.word_id, COUNT(*) AS remembered_count, MAX(r.id) AS last_review_id
    FROM reviews r
    JOIN progress p ON p.word_id = r.word_id
    WHERE r.reviewed_on = ?
      AND r.direction = 'forward'
      AND r.answer IN ('know', 'known_forever')
      AND NOT EXISTS (
        SELECT 1 FROM stage1_tasks today_tasks
        WHERE today_tasks.reviewed_on = ? AND today_tasks.word_id = r.word_id
      )
    GROUP BY r.word_id
    ORDER BY remembered_count ASC, last_review_id ASC, r.word_id ASC
    LIMIT ?
  `, [yesterday, studyDate, MAX_RELIEF_WORDS]).map((row) => ({
    wordId: Number(row.word_id),
    rememberedCount: Number(row.remembered_count ?? 0)
  }));
};

/**
 * 昨天记忆越省力,今日减负越多;始终在 6-12 张内。
 * 减负词不改今日 stage1_tasks,所以不会让今日新词漏出计划。
 */
const reliefCountFor = (candidates: ReliefCandidate[]): number => {
  if (candidates.length < MIN_RELIEF_WORDS) return 0;
  const averageRememberedCount = candidates.reduce(
    (sum, candidate) => sum + candidate.rememberedCount,
    0
  ) / candidates.length;
  const performanceBonus = Math.min(
    MAX_RELIEF_WORDS - MIN_RELIEF_WORDS,
    Math.max(0, Math.round((3 - averageRememberedCount) * 3))
  );
  return Math.min(
    candidates.length,
    MIN_RELIEF_WORDS + performanceBonus
  );
};

/**
 * 找出昨天表现稳定、今天本来不会进入计划的词。
 * 这组词只用于前端「减负」动画,不进入 stage1_tasks,也不写 reviews/FSRS。
 * app_state 只记录当天演出播到哪一张,不是学习队列。
 */
export const ensureDailyRelief = (): DailyReliefState => {
  const studyDate = today();
  ensureStage1Tasks();
  const existing = readState(studyDate);
  const raw = getState(RELIEF_STATE_KEY, "");
  let hasCurrentState = false;
  if (raw) {
    try {
      hasCurrentState = (JSON.parse(raw) as Partial<DailyReliefState>).studyDate === studyDate;
    } catch {
      hasCurrentState = false;
    }
  }
  if (existing.wordIds.length > 0 || hasCurrentState) return existing;

  const candidates = reliefCandidates(studyDate);
  const reliefCount = reliefCountFor(candidates);
  const wordIds = candidates.slice(0, reliefCount).map((candidate) => candidate.wordId);
  // 不足 6 张就不播半套动画，避免「减负」看起来像一个不稳定的奖励。
  return writeState({
    studyDate,
    wordIds,
    completed: 0
  });
};

export const getDailyReliefProgress = (): { total: number; completed: number; pending: number } => {
  const state = readState();
  return {
    total: state.wordIds.length,
    completed: state.completed,
    pending: Math.max(state.wordIds.length - state.completed, 0)
  };
};

const reliefCardById = (wordId: number): WordCard | null => {
  const row = firstRow(`
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
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `, [wordId]);
  return row ? rowObjectToCard(row) : null;
};

export const getDailyReliefNext = (): WordCard | null => {
  const state = ensureDailyRelief();
  const wordId = state.wordIds[state.completed];
  return wordId == null ? null : reliefCardById(wordId);
};

export const advanceDailyRelief = (): DailyReliefState => {
  const state = readState();
  if (state.completed >= state.wordIds.length) return state;
  return writeState({ ...state, completed: state.completed + 1 });
};

export const dailyReliefCountForToday = (): number => getDailyReliefProgress().completed;
