import type { WordCard } from "../../types/vocabulary";
import { firstRow, getState, persistSoon, rowsFor, setState, studyDayEnd, today } from "../study-core";
import { notifyProgressUpdated } from "../progress-events";
import { rowObjectToCard } from "../models/word-card";
import { recallFromRow } from "../fsrs-store";
import { stage1ProgressCounts } from "./stage1";
import { ensureDailyRelief } from "./daily-relief";

const TAIL_STATE_KEY = "daily_tail_v1";
const MIN_TAIL_WORDS = 3;
const MAX_TAIL_WORDS = 7;

interface DailyTailState {
  studyDate: string;
  wordIds: number[];
  completed: number;
}

const emptyTail = (studyDate = today()): DailyTailState => ({ studyDate, wordIds: [], completed: 0 });

const readTail = (studyDate = today()): DailyTailState => {
  const raw = getState(TAIL_STATE_KEY, "");
  if (!raw) return emptyTail(studyDate);
  try {
    const parsed = JSON.parse(raw) as Partial<DailyTailState>;
    if (parsed.studyDate !== studyDate) return emptyTail(studyDate);
    const wordIds = Array.isArray(parsed.wordIds)
      ? parsed.wordIds.map(Number).filter((id) => Number.isFinite(id))
      : [];
    return {
      studyDate,
      wordIds: Array.from(new Set(wordIds)),
      completed: Math.min(Math.max(Number(parsed.completed ?? 0), 0), wordIds.length)
    };
  } catch {
    return emptyTail(studyDate);
  }
};

const writeTail = (state: DailyTailState): DailyTailState => {
  setState(TAIL_STATE_KEY, JSON.stringify(state));
  persistSoon();
  notifyProgressUpdated();
  return state;
};

const highRecallRows = (): Record<string, unknown>[] => {
  const day = today();
  const dayEnd = studyDayEnd().toISOString();
  const reliefWordIds = new Set(ensureDailyRelief().wordIds);
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
      p.fsrs_last_review,
      p.fsrs_state,
      p.fsrs_steps,
      p.fsrs_reps,
      p.fsrs_lapses,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count >= 3
      AND p.fsrs_due IS NOT NULL
      AND p.fsrs_due > ?
      AND NOT EXISTS (
        SELECT 1 FROM stage1_tasks t
        WHERE t.reviewed_on = ? AND t.word_id = p.word_id
      )
  `, [dayEnd, day]);
  return rows
    .map((row) => ({ row, recall: recallFromRow(row) ?? 0 }))
    .filter((item) => !reliefWordIds.has(Number(item.row.id)))
    .filter((item) => item.recall >= 0.82)
    .sort((left, right) => right.recall - left.recall || Math.random() - 0.5)
    .slice(0, MAX_TAIL_WORDS)
    .map((item) => item.row);
};

/**
 * 真正结尾的轻松压轴卡。后台会在今日计划建立后预选，且不进入今日任务表；
 * 只有前置计划完全毕业后才允许 getDailyTailNext() 把它们交给前端。
 * 它们仍可走正式答题，所以用户如果想再确认一次，FSRS 会照常保存结果。
 */
export const ensureDailyTail = (): DailyTailState => {
  const studyDate = today();
  const existing = readTail(studyDate);
  const raw = getState(TAIL_STATE_KEY, "");
  let hasCurrentState = false;
  if (raw) {
    try {
      hasCurrentState = (JSON.parse(raw) as Partial<DailyTailState>).studyDate === studyDate;
    } catch {
      hasCurrentState = false;
    }
  }
  if (existing.wordIds.length > 0 || hasCurrentState) return existing;
  const frontPlan = stage1ProgressCounts();
  if (frontPlan.total <= 0) return emptyTail(studyDate);
  const wordIds = highRecallRows().map((row) => Number(row.id));
  const tailSize = wordIds.length >= MIN_TAIL_WORDS
    ? MIN_TAIL_WORDS + Math.floor(Math.random() * (Math.min(MAX_TAIL_WORDS, wordIds.length) - MIN_TAIL_WORDS + 1))
    : 0;
  return writeTail({ studyDate, wordIds: wordIds.slice(0, tailSize), completed: 0 });
};

const tailCardById = (wordId: number): WordCard | null => {
  const row = firstRow(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count,
           p.forgot_count, p.mistake_streak,
           p.fsrs_stability, p.fsrs_difficulty, p.fsrs_due, p.fsrs_last_review,
           p.fsrs_state, p.fsrs_steps, p.fsrs_reps, p.fsrs_lapses,
           COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `, [wordId]);
  return row ? rowObjectToCard(row) : null;
};

/** 把压轴卡声明为当前正向卡，复用既有的防重复提交锁。 */
const prepareTailCard = (wordId: number) => {
  setState("phase_date", today());
  setState("phase", "stage1");
  setState("current_card", String(wordId));
};

export const getDailyTailNext = (): WordCard | null => {
  const state = ensureDailyTail();
  const frontPlan = stage1ProgressCounts();
  if (frontPlan.total <= 0 || frontPlan.completed < frontPlan.total) return null;
  const wordId = state.wordIds[state.completed];
  if (wordId == null) return null;
  const card = tailCardById(wordId);
  if (card) prepareTailCard(wordId);
  return card;
};

export const getDailyTailProgress = (): { total: number; completed: number; pending: number } => {
  const state = readTail();
  return {
    total: state.wordIds.length,
    completed: state.completed,
    pending: Math.max(state.wordIds.length - state.completed, 0)
  };
};

export const advanceDailyTail = (): DailyTailState => {
  const state = readTail();
  if (state.completed >= state.wordIds.length) return state;
  return writeTail({ ...state, completed: state.completed + 1 });
};
