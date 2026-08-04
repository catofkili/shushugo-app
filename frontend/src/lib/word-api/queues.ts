import { getDatabase } from "../database";
import type { WordCard } from "../../types/vocabulary";
import { hasKanjiText, rowObjectToCard } from "../models/word-card";
import { pickDueCriticalPoolRow } from "../scheduler/priority";
import { daysSince, DbRow, firstRow, firstValue, rowsFor, SqlValue, today } from "../study-core";
import { ensureStage1Tasks } from "./stage1";

/**
 * Stage2(默写)和汉字两条队列:入队、推进、统计、出题。
 * 两者结构几乎对称,所以放同一个模块;和 Stage1 的区别是它们只在当天任务内轮转,
 * 不涉及每日计划生成和复习上限。
 *
 * 从 word-api.ts 原样搬出,逻辑一字未改。
 */

export const recordStage2Word = (wordId: number) => {
  const day = today();
  const db = getDatabase();
  const exists = firstValue<number>(
    "SELECT 1 FROM stage2_progress WHERE reviewed_on = ? AND word_id = ?",
    [day, wordId],
    0
  );
  if (exists) return;
  const orderIndex = firstValue<number>(
    "SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage2_progress WHERE reviewed_on = ?",
    [day],
    1
  );
  db.run(
    "INSERT INTO stage2_progress (reviewed_on, word_id, order_index) VALUES (?, ?, ?)",
    [day, wordId, orderIndex]
  );
};

export const backfillStage2FromReviews = () => {
  const day = today();
  const rows = rowsFor(`
    SELECT word_id, MIN(id) AS first_review_id
    FROM reviews
    WHERE reviewed_on = ? AND answer != 'known_forever'
    GROUP BY word_id
    ORDER BY first_review_id ASC
  `, [day]);
  rows.forEach((row, index) => {
    getDatabase().run(`
      INSERT OR IGNORE INTO stage2_progress (reviewed_on, word_id, order_index)
      VALUES (?, ?, ?)
    `, [day, Number(row.word_id), index + 1]);
  });
  getDatabase().run(`
    WITH rollup AS (
      SELECT
        word_id,
        COUNT(*) AS seen,
        CASE
          WHEN SUM(
            CASE answer
              WHEN 'forgot' THEN -10
              WHEN 'fuzzy' THEN -5
              WHEN 'know' THEN 10
              ELSE 0
            END
          ) < -40 THEN -40
          ELSE SUM(
            CASE answer
              WHEN 'forgot' THEN -10
              WHEN 'fuzzy' THEN -5
              WHEN 'know' THEN 10
              ELSE 0
            END
          )
        END AS score
      FROM reviews
      WHERE reviewed_on = ?
        AND answer != 'known_forever'
      GROUP BY word_id
    )
    UPDATE stage2_progress
    SET temp_score = (
        SELECT score FROM rollup WHERE rollup.word_id = stage2_progress.word_id
      ),
      seen_count = (
        SELECT seen FROM rollup WHERE rollup.word_id = stage2_progress.word_id
      ),
      completed = CASE
        WHEN (
          SELECT score FROM rollup WHERE rollup.word_id = stage2_progress.word_id
        ) >= 10 THEN 1
        ELSE completed
      END,
      due_after = CASE
        WHEN (
          SELECT score FROM rollup WHERE rollup.word_id = stage2_progress.word_id
        ) >= 10 THEN NULL
        ELSE due_after
      END
    WHERE reviewed_on = ?
      AND seen_count = 0
      AND word_id IN (SELECT word_id FROM rollup)
  `, [day, day]);
  getDatabase().run(`
    UPDATE stage2_progress
    SET completed = 1,
        due_after = NULL
    WHERE reviewed_on = ?
      AND word_id IN (
        SELECT word_id
        FROM progress
        WHERE known_forever = 1
      )
  `, [day]);
};

export const advanceStage2Queue = (answeredWordId: number) => {
  getDatabase().run(`
    UPDATE stage2_progress
    SET due_after = MAX(COALESCE(due_after, 0) - 1, 0)
    WHERE reviewed_on = ?
      AND completed = 0
      AND word_id != ?
      AND due_after IS NOT NULL
  `, [today(), answeredWordId]);
};

export const stage2Stats = () => {
  const row = firstRow(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
    FROM stage2_progress
    WHERE reviewed_on = ?
  `, [today()]);
  return {
    total: Number(row?.total ?? 0),
    completed: Number(row?.completed ?? 0)
  };
};

export const pickStage2Next = (excludedIds: Set<number> = new Set()): WordCard | null => {
  const rows = rowsFor(`
    SELECT w.*, s.temp_score AS score, s.temp_score, s.seen_count, s.due_after, s.order_index, COALESCE(n.note, '') AS note
    FROM stage2_progress s
    JOIN words w ON w.id = s.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE s.reviewed_on = ?
      AND s.completed = 0
  `, [today()]);

  const availableRows = rows.filter((row) => !excludedIds.has(Number(row.id)));
  const criticalPoolRow = pickDueCriticalPoolRow(availableRows);
  if (criticalPoolRow) return rowObjectToCard(criticalPoolRow);

  const dueRows = availableRows.filter((row) => row.due_after == null || Number(row.due_after) <= 0);
  if (dueRows.length) {
    dueRows.sort((left, right) => (
      Number(left.temp_score ?? 0) - Number(right.temp_score ?? 0)
      || Number(left.seen_count ?? 0) - Number(right.seen_count ?? 0)
      || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
    ));
    return rowObjectToCard(dueRows[0]);
  }
  if (!availableRows.length) return null;
  availableRows.sort((left, right) => (
    Number(left.due_after ?? 0) - Number(right.due_after ?? 0)
    || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
  ));
  return rowObjectToCard(availableRows[0]);
};

const dateGapDays = (lastSeenOn: SqlValue) => {
  if (!lastSeenOn) return 30;
  return daysSince(lastSeenOn);
};

const kanjiPriority = (row: DbRow) => {
  const memoryScore = Number(row.memory_score ?? 0);
  const memorySeen = Number(row.memory_seen_count ?? 0);
  const forgot = Number(row.kanji_forgot_count ?? 0);
  const fuzzy = Number(row.kanji_fuzzy_count ?? 0);
  const right = Number(row.kanji_right_count ?? 0);
  const lowHistory = Number(row.kanji_low_history ?? 0);
  const todaySeen = Number(row.today_seen_count ?? 0);
  let score = 50;
  score += Math.max(0, 10 - memoryScore) * 4;
  score += forgot * 12 + fuzzy * 6;
  if (lowHistory) score += 25;
  score += Math.min(15, dateGapDays(row.kanji_last_seen_on) * 2);
  if (memorySeen === 0) score += 8;
  if (right >= forgot + fuzzy + 3 && memoryScore >= 10) score -= 10;
  score -= todaySeen * 8;
  return Math.round(score * 10000) / 10000;
};

export const buildKanjiProgressFromReviews = () => {
  const day = today();
  ensureStage1Tasks();
  const rows = rowsFor(`
    SELECT
      t.word_id,
      w.kanji,
      t.order_index,
      COALESCE(km.score, 0) AS memory_score,
      COALESCE(km.seen_count, 0) AS memory_seen_count,
      COALESCE(km.right_count, 0) AS kanji_right_count,
      COALESCE(km.fuzzy_count, 0) AS kanji_fuzzy_count,
      COALESCE(km.forgot_count, 0) AS kanji_forgot_count,
      COALESCE(km.low_history, 0) AS kanji_low_history,
      km.last_seen_on AS kanji_last_seen_on,
      COALESCE(kp.seen_count, 0) AS today_seen_count
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    LEFT JOIN kanji_memory km ON km.word_id = t.word_id
    LEFT JOIN kanji_progress kp ON kp.reviewed_on = t.reviewed_on AND kp.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND w.kanji != w.kana
    ORDER BY t.order_index ASC
  `, [day]).filter((row) => hasKanjiText(String(row.kanji ?? "")));

  rows
    .map((row) => ({ row, priority: kanjiPriority(row) }))
    .sort((left, right) => right.priority - left.priority || Number(right.row.order_index ?? 0) - Number(left.row.order_index ?? 0))
    .forEach(({ row }, index) => {
      getDatabase().run(`
        INSERT INTO kanji_progress (reviewed_on, word_id, order_index, temp_score, completed)
        VALUES (?, ?, ?, 0, 0)
        ON CONFLICT(reviewed_on, word_id) DO UPDATE SET
          order_index = excluded.order_index
      `, [day, Number(row.word_id), index + 1]);
    });
};

export const advanceKanjiQueue = (answeredWordId: number) => {
  getDatabase().run(`
    UPDATE kanji_progress
    SET due_after = MAX(COALESCE(due_after, 0) - 1, 0)
    WHERE reviewed_on = ?
      AND completed = 0
      AND word_id != ?
      AND due_after IS NOT NULL
  `, [today(), answeredWordId]);
};

export const kanjiStats = () => {
  const row = firstRow(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
    FROM kanji_progress
    WHERE reviewed_on = ?
  `, [today()]);
  return {
    total: Number(row?.total ?? 0),
    completed: Number(row?.completed ?? 0)
  };
};

export const pickKanjiNext = (excludedIds: Set<number> = new Set()): WordCard | null => {
  const rows = rowsFor(`
    SELECT
      w.*,
      k.temp_score AS score,
      k.order_index,
      k.due_after,
      k.seen_count AS today_seen_count,
      COALESCE(km.score, 0) AS memory_score,
      COALESCE(km.seen_count, 0) AS memory_seen_count,
      COALESCE(km.right_count, 0) AS kanji_right_count,
      COALESCE(km.fuzzy_count, 0) AS kanji_fuzzy_count,
      COALESCE(km.forgot_count, 0) AS kanji_forgot_count,
      COALESCE(km.low_history, 0) AS kanji_low_history,
      km.last_seen_on AS kanji_last_seen_on,
      COALESCE(n.note, '') AS note
    FROM kanji_progress k
    JOIN words w ON w.id = k.word_id
    LEFT JOIN kanji_memory km ON km.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE k.reviewed_on = ?
      AND k.completed = 0
  `, [today()]);

  const availableRows = rows.filter((row) => !excludedIds.has(Number(row.id)));
  const criticalPoolRow = pickDueCriticalPoolRow(availableRows);
  if (criticalPoolRow) return rowObjectToCard(criticalPoolRow);

  const dueRows = availableRows.filter((row) => row.due_after == null || Number(row.due_after) <= 0);
  if (dueRows.length) {
    dueRows.sort((left, right) => kanjiPriority(right) - kanjiPriority(left) || Number(left.order_index ?? 0) - Number(right.order_index ?? 0));
    return rowObjectToCard(dueRows[0]);
  }
  if (!availableRows.length) return null;
  availableRows.sort((left, right) => (
    Number(left.due_after ?? 0) - Number(right.due_after ?? 0)
    || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
  ));
  return rowObjectToCard(availableRows[0]);
};
