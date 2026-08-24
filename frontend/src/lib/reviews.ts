import { firstValue } from "./database/db-utils";
import { getDatabase } from "./database";
import { ensureSyncSchema } from "./sync/schema";

/** Bump when scheduler parameters change in a way that affects replay/audit. */
export const FSRS_PARAMS_VERSION = "fsrs-v1";

export interface ReviewEventInput {
  wordId: number;
  answer: string;
  reviewedOn: string;
  direction: string;
  schedulerMode?: string;
  reviewedAt?: number;
}

/**
 * One write path for review events. `sync_uid` is assigned by the sync
 * trigger after INSERT; it is the cross-device event identity, never `id` or
 * second-resolution `created_at`.
 */
export const recordReviewEvent = ({
  wordId,
  answer,
  reviewedOn,
  direction,
  schedulerMode = "normal",
  reviewedAt = Date.now()
}: ReviewEventInput): number => {
  ensureSyncSchema();
  const db = getDatabase();
  db.run(`
    INSERT INTO reviews (
      word_id, answer, score_after, reviewed_on, direction,
      reviewed_at, scheduler_mode, fsrs_params_version
    ) VALUES (?, ?, 0, ?, ?, ?, ?, ?)
  `, [wordId, answer, reviewedOn, direction, reviewedAt, schedulerMode, FSRS_PARAMS_VERSION]);
  return firstValue<number>("SELECT last_insert_rowid()", [], 0);
};
