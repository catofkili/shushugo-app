import type { WordCard } from "../../types/vocabulary";
import { rowObjectToCard } from "../models/word-card";
import { allowsBackToBack } from "../scheduler/requeue";
import { rowsFor, studyDayEnd, today } from "../study-core";
import { mistakeCandidateSql } from "./filters";
import { getReviewQueue, lastAnsweredWord } from "./session-state";

type MistakeRow = Record<string, unknown>;

const mistakeRisk = (row: MistakeRow): number => {
  const lapses = Number(row.fsrs_lapses ?? 0);
  const difficulty = Number(row.fsrs_difficulty ?? 0);
  const stability = Math.max(Number(row.fsrs_stability ?? 0), 0);
  const forgot = Number(row.forgot_count ?? 0);
  const fuzzy = Number(row.fuzzy_count ?? 0);
  const right = Number(row.right_count ?? 0);
  const weightedWrong = forgot * 2 + fuzzy;
  const errorRate = weightedWrong / Math.max(right + weightedWrong, 1);

  // 先看真正的长期遗忘次数，再看 FSRS 难度和历史错误率；低稳定度稍微前置。
  return lapses * 100 + difficulty * 8 + errorRate * 50 - Math.min(stability, 365) * 0.03;
};

/**
 * 错题本只改变选词：从共用 progress/FSRS 记忆中找长期薄弱词。
 * 今天答对并被排到明天以后的词会退出本轮；答错后仍在重学步骤中的词继续留下。
 */
export const pickMistakeNext = (): WordCard | null => {
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
      p.fsrs_reps,
      p.fsrs_lapses,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND ${mistakeCandidateSql("p")}
      AND (
        p.last_seen_on IS NULL
        OR p.last_seen_on <> ?
        OR p.fsrs_due IS NULL
        OR p.fsrs_due <= ?
      )
  `, [day, dayEnd]);
  if (!rows.length) return null;

  const queueById = new Map(getReviewQueue().map((item) => [item.word_id, item.due_after]));
  const lastId = lastAnsweredWord();
  const lastRow = rows.find((row) => Number(row.id) === lastId);
  const repeatAllowed = allowsBackToBack({
    mistakeStreak: Number(lastRow?.mistake_streak ?? 0),
    remaining: rows.length,
    total: rows.length
  });
  const pickable = rows.length > 1 && !repeatAllowed
    ? rows.filter((row) => Number(row.id) !== lastId)
    : rows;
  const candidates = pickable.map((row) => ({
    row,
    dueAfter: queueById.get(Number(row.id)) ?? 0,
    risk: mistakeRisk(row)
  }));
  const ready = candidates.filter((item) => item.dueAfter <= 0);
  const pool = ready.length ? ready : candidates;
  pool.sort((left, right) => (
    ready.length
      ? right.risk - left.risk
      : left.dueAfter - right.dueAfter || right.risk - left.risk
  ));
  return pool[0] ? rowObjectToCard(pool[0].row) : null;
};
