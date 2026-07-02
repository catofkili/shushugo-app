import { getDatabase } from "./database";
import { WordAnswer, WordCard, WordSessionResponse, WordStats } from "../types/vocabulary";
import { getDailyWordGoal } from "./studyPreferences";
import { hasKanjiText, rowObjectToCard } from "./models/word-card";
import { pickDueCriticalPoolRow, pickStage1CriticalPoolRow, priorityComponents, priorityScore } from "./scheduler/priority";
import {
  answerScore,
  CRITICAL_SCORE,
  daysSince,
  DbRow,
  ensureJlptWordSeed,
  ensureUserTables,
  firstRow,
  firstValue,
  getState,
  persistSoon,
  randomBetween,
  rowsFor,
  setState,
  SqlValue,
  today
} from "./study-core";
import type { WordSessionOptions } from "./study-types";
import { applyGrammarDailyDecay, ensureGrammarProgressInitialized } from "./grammar-api";

// 导出分析统计功能
export { getStudyAnalytics } from "./analytics/stats";
export type {
  FavoriteItem,
  FavoriteType,
  GrammarMistakeItem,
  GrammarStudyCard,
  GrammarStudySession,
  GrammarStudyStats,
  LevelProgressItem,
  ProgressOverview,
  StudyAnswer,
  WordSessionOptions
} from "./study-types";
export {
  getGrammarMistakes,
  getGrammarPointFavorite,
  getGrammarSession,
  getGrammarStats,
  prioritizeGrammarMistake,
  resolveGrammarMistake,
  submitGrammarAnswer
} from "./grammar-api";
export { getFavoriteItems, toggleFavorite } from "./favorites-api";

const wordFilterSql = (options: WordSessionOptions = {}, alias = "w") => {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const level = options.level ?? "All";
  const type = options.type ?? "all";

  if (level !== "All") {
    if (level === "Unleveled") {
      clauses.push(`(${alias}.jlpt_level IS NULL OR ${alias}.jlpt_level = '')`);
    } else {
      clauses.push(`${alias}.jlpt_level = ?`);
      params.push(level);
    }
  }

  if (type === "favorite") {
    clauses.push(`EXISTS (
      SELECT 1 FROM content_favorites cf
      WHERE cf.item_type = 'word' AND cf.item_id = CAST(${alias}.id AS TEXT)
    )`);
  } else if (type === "noun") {
    clauses.push(`(${alias}.pos LIKE '%名%' OR ${alias}.pos LIKE '%名词%')`);
  } else if (type === "verb") {
    clauses.push(`(
      ${alias}.pos LIKE '%動%' OR
      ${alias}.pos LIKE '%动词%' OR
      ${alias}.pos LIKE '%自动%' OR
      ${alias}.pos LIKE '%他动%' OR
      ${alias}.pos LIKE '%自動%' OR
      ${alias}.pos LIKE '%他動%'
    )`);
  } else if (type === "adjective") {
    clauses.push(`(${alias}.pos LIKE '%形%' OR ${alias}.pos LIKE '%形容词%')`);
  } else if (type === "adverb") {
    clauses.push(`(${alias}.pos LIKE '%副%' OR ${alias}.pos LIKE '%副词%')`);
  }

  return {
    clause: clauses.length ? ` AND ${clauses.join(" AND ")} ` : "",
    params
  };
};

const hasWordFilter = (options: WordSessionOptions = {}) => (
  (options.level ?? "All") !== "All" || (options.type ?? "all") !== "all"
);

export const ensureProgressInitialized = () => {
  const db = getDatabase();
  ensureUserTables();
  ensureJlptWordSeed();
  db.run(`
    INSERT OR IGNORE INTO progress (word_id)
    SELECT id FROM words
  `);
  db.run("UPDATE words SET shuffle_rank = ABS(RANDOM()) / 9223372036854775807.0 WHERE shuffle_rank IS NULL");
  db.run("UPDATE progress SET score = 0 WHERE seen_count = 0 AND score < 0");
  if (!getState("first_study_day", "")) {
    setState("first_study_day", today());
  }
  ensureGrammarProgressInitialized();
  backfillStage2FromReviews();
  applyDailyDecay();
  applyGrammarDailyDecay();
};

const mistakeScore = (row: DbRow) => {
  const wrongish = Number(row.forgot_count ?? 0) * 2 + Number(row.fuzzy_count ?? 0);
  const total = wrongish + Number(row.right_count ?? 0);
  if (total === 0) return 0;
  const streakBonus = Math.min(Number(row.mistake_streak ?? 0) * 0.08, 0.32);
  return Math.min(wrongish / total + streakBonus, 1);
};

const weightedDecayTenths = (row: DbRow) => {
  let decay = 10;
  decay += Number(row.importance ?? 3) - 3;
  decay += Math.round(mistakeScore(row) * 2);
  if (Number(row.right_count ?? 0) >= Number(row.forgot_count ?? 0) + Number(row.fuzzy_count ?? 0) + 3) {
    decay -= 1;
  }
  return Math.min(Math.max(decay, 8), 12);
};

const backfillCriticalReviews = (beforeDay: string) => {
  getDatabase().run(`
    INSERT OR IGNORE INTO critical_reviews (reviewed_on, word_id)
    SELECT reviewed_on, word_id
    FROM reviews
    WHERE reviewed_on < ?
      AND score_after <= ?
  `, [beforeDay, CRITICAL_SCORE]);
};

const resetPreviousCriticalReviews = (day: string) => {
  const db = getDatabase();
  db.run(`
    UPDATE progress
    SET score = -1,
        mastered_on = NULL
    WHERE known_forever = 0
      AND word_id IN (
        SELECT word_id
        FROM critical_reviews
        WHERE reviewed_on < ?
          AND reset_on IS NULL
      )
  `, [day]);
  db.run(`
    UPDATE critical_reviews
    SET reset_on = ?
    WHERE reviewed_on < ?
      AND reset_on IS NULL
  `, [day, day]);
};

const applyDailyDecay = () => {
  const day = today();
  const lastDecay = getState("last_decay", "");
  if (!lastDecay) {
    setState("last_decay", day);
    return;
  }
  if (lastDecay === day) return;

  const db = getDatabase();
  const rows = rowsFor(`
    SELECT w.importance, p.*
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND p.seen_count > 0
  `);

  rows.forEach((row) => {
    const decay = weightedDecayTenths(row);
    db.run(`
      UPDATE progress
      SET score = MAX(score - ?, -40),
          mastered_on = NULL,
          last_decay_amount = ?
      WHERE word_id = ?
    `, [decay / 10, decay, Number(row.word_id)]);
  });

  backfillCriticalReviews(day);
  resetPreviousCriticalReviews(day);
  setState("last_decay", day);
};

const dailyNewQuota = () => {
  return getDailyWordGoal();
};

export const getReviewQueue = (): { word_id: number; due_after: number }[] => {
  try {
    const queue = JSON.parse(getState("review_queue", "[]"));
    if (!Array.isArray(queue)) return [];
    return queue.flatMap((item) => {
      const wordId = Number(item?.word_id);
      if (!Number.isFinite(wordId)) return [];
      return [{ word_id: wordId, due_after: Math.max(Number(item?.due_after ?? 0), 0) }];
    });
  } catch {
    return [];
  }
};

export const setReviewQueue = (queue: { word_id: number; due_after: number }[]) => {
  setState("review_queue", JSON.stringify(queue));
};

const advanceReviewQueue = (answeredWordId: number) => {
  setReviewQueue(getReviewQueue().flatMap((item) => {
    if (item.word_id === answeredWordId) return [];
    return [{ word_id: item.word_id, due_after: Math.max(item.due_after - 1, 0) }];
  }));
};

const scheduleDelayedReview = (wordId: number) => {
  const queue = getReviewQueue().filter((item) => item.word_id !== wordId);
  queue.push({ word_id: wordId, due_after: randomBetween(4, 8) });
  setReviewQueue(queue);
};

const currentPhase = () => {
  const day = today();
  if (getState("phase_date", "") !== day) {
    setState("phase_date", day);
    setState("phase", "stage1");
  }
  const phase = getState("phase", "stage1");
  if (phase === "stage2") {
    const stage2 = stage2Stats();
    if (stage2.total > 0 && stage2.completed >= stage2.total) {
      setState("phase", "kanji");
      return "kanji";
    }
  }
  if (phase === "kanji") {
    const kanji = kanjiStats();
    if (kanji.total > 0 && kanji.completed >= kanji.total) {
      setState("phase", "done");
      return "done";
    }
  }
  return phase;
};

const setPhase = (phase: string) => {
  setState("phase_date", today());
  setState("phase", phase);
};

const recordCheckin = () => {
  getDatabase().run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)", [today()]);
};

const stage1TaskCount = (day: string) => firstValue<number>(
  "SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?",
  [day],
  0
);

const backfillStage1TasksFromReviews = (day: string) => {
  const rows = rowsFor(`
    SELECT
      today_reviews.word_id,
      MIN(today_reviews.id) AS first_review_id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM reviews earlier_reviews
          WHERE earlier_reviews.word_id = today_reviews.word_id
            AND earlier_reviews.reviewed_on < ?
        )
        THEN 'review'
        ELSE 'new'
      END AS task_type
    FROM reviews today_reviews
    WHERE today_reviews.reviewed_on = ?
    GROUP BY today_reviews.word_id
    ORDER BY first_review_id ASC
  `, [day, day]);

  rows.forEach((row, index) => {
    getDatabase().run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, ?, ?)
    `, [day, Number(row.word_id), String(row.task_type ?? "review"), index + 1]);
  });
};

const activateMojiMigratedReviews = (day: string) => {
  const rows = rowsFor(`
    SELECT m.word_id
    FROM moji_migrated_reviews m
    JOIN progress p ON p.word_id = m.word_id
    JOIN words w ON w.id = m.word_id
    WHERE m.activated_on IS NULL
      AND p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= 6
    ORDER BY m.priority DESC, p.score ASC, w.importance DESC, m.word_id ASC
    LIMIT 30
  `);

  rows.forEach((row) => {
    getDatabase().run("UPDATE moji_migrated_reviews SET activated_on = ? WHERE word_id = ?", [day, Number(row.word_id)]);
  });
};

const createStage1Tasks = (day: string) => {
  const db = getDatabase();
  if (stage1TaskCount(day) > 0) return;
  if (firstValue<number>("SELECT 1 FROM reviews WHERE reviewed_on = ? LIMIT 1", [day], 0)) {
    backfillStage1TasksFromReviews(day);
    return;
  }

  activateMojiMigratedReviews(day);

  let orderIndex = 1;
  const reviewRows = rowsFor(`
    SELECT p.word_id
    FROM progress p
    JOIN words w ON w.id = p.word_id
    LEFT JOIN moji_migrated_reviews m ON m.word_id = p.word_id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= 6
      AND (m.word_id IS NULL OR m.activated_on IS NOT NULL)
    ORDER BY
      CASE WHEN m.word_id IS NULL THEN 0 ELSE 1 END ASC,
      p.score ASC,
      p.low_history DESC,
      w.importance DESC,
      COALESCE(m.priority, 0) DESC,
      p.last_seen_on ASC,
      p.word_id ASC
  `);

  reviewRows.forEach((row) => {
    db.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'review', ?)
    `, [day, Number(row.word_id), orderIndex]);
    orderIndex += 1;
  });

  const newRows = rowsFor(`
    SELECT p.word_id
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0
      AND p.seen_count = 0
    ORDER BY w.shuffle_rank DESC, w.importance DESC, p.word_id ASC
    LIMIT ?
  `, [dailyNewQuota()]);

  newRows.forEach((row) => {
    db.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'new', ?)
    `, [day, Number(row.word_id), orderIndex]);
    orderIndex += 1;
  });
};

const ensureStage1Tasks = () => {
  const day = today();
  createStage1Tasks(day);
};

const stage1ProgressCounts = () => {
  const day = today();
  ensureStage1Tasks();
  const total = stage1TaskCount(day);
  const completed = firstValue<number>(`
    SELECT SUM(
      CASE
        WHEN p.known_forever = 1 THEN 1
        WHEN p.score > 6 THEN 1
        ELSE 0
      END
    )
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
  `, [day], 0);

  return {
    completed: Math.min(Number(completed ?? 0), total),
    total
  };
};

const pickStage1Next = (): WordCard | null => {
  const day = today();
  ensureStage1Tasks();
  const queueById = new Map(getReviewQueue().map((item) => [item.word_id, item.due_after]));
  const newQuotaLeft = firstValue<number>(`
    SELECT COUNT(*)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND t.task_type = 'new'
      AND p.seen_count = 0
      AND p.known_forever = 0
  `, [day], 0);
  const criticalCount = firstValue<number>(`
    SELECT COUNT(*)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND p.score <= ?
  `, [day, CRITICAL_SCORE], 0);

  const rows = rowsFor(`
    SELECT
      w.*,
      p.word_id,
      p.score,
      p.seen_count,
      p.low_history,
      p.known_forever,
      p.mastered_on,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.last_decay_amount,
      t.task_type,
      t.order_index,
      COALESCE(n.note, '') AS note
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND p.score <= 6
  `, [day]);

  const criticalPoolRow = pickStage1CriticalPoolRow(rows, queueById);
  if (criticalPoolRow) return rowObjectToCard(criticalPoolRow);

  const candidates = rows.map((row) => {
    const components = priorityComponents(row, queueById.get(Number(row.id)), criticalCount, newQuotaLeft);
    return {
      score: priorityScore(components),
      row
    };
  });
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.score - left.score);
  return rowObjectToCard(candidates[0].row);
};

const recordStage2Word = (wordId: number) => {
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

const backfillStage2FromReviews = () => {
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

const advanceStage2Queue = (answeredWordId: number) => {
  getDatabase().run(`
    UPDATE stage2_progress
    SET due_after = MAX(COALESCE(due_after, 0) - 1, 0)
    WHERE reviewed_on = ?
      AND completed = 0
      AND word_id != ?
      AND due_after IS NOT NULL
  `, [today(), answeredWordId]);
};

const stage2Stats = () => {
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

const pickStage2Next = (): WordCard | null => {
  const rows = rowsFor(`
    SELECT w.*, s.temp_score AS score, s.temp_score, s.seen_count, s.due_after, s.order_index, COALESCE(n.note, '') AS note
    FROM stage2_progress s
    JOIN words w ON w.id = s.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE s.reviewed_on = ?
      AND s.completed = 0
  `, [today()]);

  const criticalPoolRow = pickDueCriticalPoolRow(rows);
  if (criticalPoolRow) return rowObjectToCard(criticalPoolRow);

  const dueRows = rows.filter((row) => row.due_after == null || Number(row.due_after) <= 0);
  if (dueRows.length) {
    dueRows.sort((left, right) => (
      Number(left.temp_score ?? 0) - Number(right.temp_score ?? 0)
      || Number(left.seen_count ?? 0) - Number(right.seen_count ?? 0)
      || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
    ));
    return rowObjectToCard(dueRows[0]);
  }
  if (!rows.length) return null;
  rows.sort((left, right) => (
    Number(left.due_after ?? 0) - Number(right.due_after ?? 0)
    || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
  ));
  return rowObjectToCard(rows[0]);
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

const buildKanjiProgressFromReviews = () => {
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

const advanceKanjiQueue = (answeredWordId: number) => {
  getDatabase().run(`
    UPDATE kanji_progress
    SET due_after = MAX(COALESCE(due_after, 0) - 1, 0)
    WHERE reviewed_on = ?
      AND completed = 0
      AND word_id != ?
      AND due_after IS NOT NULL
  `, [today(), answeredWordId]);
};

const kanjiStats = () => {
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

const pickKanjiNext = (): WordCard | null => {
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

  const criticalPoolRow = pickDueCriticalPoolRow(rows);
  if (criticalPoolRow) return rowObjectToCard(criticalPoolRow);

  const dueRows = rows.filter((row) => row.due_after == null || Number(row.due_after) <= 0);
  if (dueRows.length) {
    dueRows.sort((left, right) => kanjiPriority(right) - kanjiPriority(left) || Number(left.order_index ?? 0) - Number(right.order_index ?? 0));
    return rowObjectToCard(dueRows[0]);
  }
  if (!rows.length) return null;
  rows.sort((left, right) => (
    Number(left.due_after ?? 0) - Number(right.due_after ?? 0)
    || Number(left.order_index ?? 0) - Number(right.order_index ?? 0)
  ));
  return rowObjectToCard(rows[0]);
};

const pickFilteredWordNext = (options: WordSessionOptions): WordCard | null => {
  const filter = wordFilterSql(options, "w");
  const dueIds = getReviewQueue().filter((item) => item.due_after <= 0).map((item) => item.word_id);
  if (dueIds.length) {
    const placeholders = dueIds.map(() => "?").join(",");
    const due = firstRow(`
      SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
             p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
             p.mistake_streak, COALESCE(n.note, '') AS note
      FROM words w
      JOIN progress p ON p.word_id = w.id
      LEFT JOIN word_notes n ON n.word_id = w.id
      WHERE w.id IN (${placeholders})
        AND p.known_forever = 0
        ${filter.clause}
      ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, w.importance DESC
      LIMIT 1
    `, [...dueIds, ...filter.params]);
    if (due) return rowObjectToCard(due);
  }

  const critical = firstRow(`
    SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= ?
      ${filter.clause}
    ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, w.importance DESC
    LIMIT 1
  `, [CRITICAL_SCORE, ...filter.params]);
  if (critical) return rowObjectToCard(critical);

  const low = firstRow(`
    SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= 6
      ${filter.clause}
    ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, w.importance DESC
    LIMIT 1
  `, filter.params);
  if (low) return rowObjectToCard(low);

  const unseen = firstRow(`
    SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count = 0
      ${filter.clause}
    ORDER BY CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END,
             w.importance DESC, w.shuffle_rank DESC, w.id ASC
    LIMIT 1
  `, filter.params);
  if (unseen) return rowObjectToCard(unseen);

  const review = firstRow(`
    SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      ${filter.clause}
    ORDER BY p.score ASC, p.last_seen_on ASC, w.importance DESC, w.shuffle_rank DESC
    LIMIT 1
  `, filter.params);
  return review ? rowObjectToCard(review) : null;
};

const dailyStudyStats = () => {
  const days = new Map<string, { date: string; seconds: number; wordCount: number }>();
  rowsFor(`
    SELECT studied_on, seconds
    FROM word_study_time
    WHERE studied_on BETWEEN '2026-06-01' AND '2027-06-30'
  `).forEach((row) => {
    const date = String(row.studied_on ?? "");
    if (!date) return;
    days.set(date, {
      date,
      seconds: Number(row.seconds ?? 0),
      wordCount: days.get(date)?.wordCount ?? 0
    });
  });
  rowsFor(`
    SELECT reviewed_on, COUNT(DISTINCT word_id) AS word_count
    FROM reviews
    WHERE reviewed_on BETWEEN '2026-06-01' AND '2027-06-30'
    GROUP BY reviewed_on
  `).forEach((row) => {
    const date = String(row.reviewed_on ?? "");
    if (!date) return;
    days.set(date, {
      date,
      seconds: days.get(date)?.seconds ?? 0,
      wordCount: Number(row.word_count ?? 0)
    });
  });
  rowsFor("SELECT checked_on FROM checkins ORDER BY checked_on").forEach((row) => {
    const date = String(row.checked_on ?? "");
    if (!date) return;
    days.set(date, days.get(date) ?? { date, seconds: 0, wordCount: 0 });
  });
  return Array.from(days.values()).sort((left, right) => left.date.localeCompare(right.date));
};

// Remember which word was just served so submitWordAnswer can reject stale or
// duplicate submissions (e.g. a rapid double-tap / touch ghost-click that fires
// before the card advances, which used to score the same word twice and re-loop
// the last words instead of reaching the settlement screen).
const setCurrentCard = (card: WordCard | null): void => {
  setState("current_card", card && card.id != null ? String(card.id) : "0");
};

// Claim the served card. Returns true if `wordId` is the card we are currently
// waiting on (and consumes it so it can only be scored once); false for a stale
// or duplicate submit. An empty value means nothing has been served yet -> allow.
// JavaScript is single-threaded, so this read-then-write needs no extra locking.
const claimCurrentCard = (wordId: number): boolean => {
  const expected = getState("current_card", "");
  if (expected === "") return true;
  if (expected === String(wordId)) {
    setState("current_card", "0");
    return true;
  }
  return false;
};

const nextCard = (options: WordSessionOptions = {}): { card: WordCard | null; phase: string } => {
  const result = resolveNextCard(options);
  setCurrentCard(result.card);
  return result;
};

const resolveNextCard = (options: WordSessionOptions = {}): { card: WordCard | null; phase: string } => {
  if (hasWordFilter(options)) {
    return { card: pickFilteredWordNext(options), phase: "filtered" };
  }
  const phase = currentPhase();
  if (phase === "done") return { card: null, phase: "done" };
  if (phase === "stage2") {
    const card = pickStage2Next();
    if (card) return { card, phase: "stage2" };
    setPhase("done");
    recordCheckin();
    return { card: null, phase: "done" };
  }
  if (phase === "kanji") {
    buildKanjiProgressFromReviews();
    const card = pickKanjiNext();
    if (card) return { card, phase: "kanji" };
    setPhase("done");
    recordCheckin();
    return { card: null, phase: "done" };
  }

  const stage1Card = pickStage1Next();
  if (stage1Card) return { card: stage1Card, phase: "stage1" };

  const stage2 = stage2Stats();
  if (stage2.total > 0 && stage2.completed < stage2.total) {
    setPhase("stage2");
    const card = pickStage2Next();
    if (card) return { card, phase: "stage2" };
  }

  buildKanjiProgressFromReviews();
  const kanji = kanjiStats();
  if (kanji.total > 0 && kanji.completed < kanji.total) {
    setPhase("kanji");
    const card = pickKanjiNext();
    if (card) return { card, phase: "kanji" };
  }

  recordCheckin();
  setPhase("done");
  return { card: null, phase: "done" };
};

export function getWordStats(phase = "stage1", options: WordSessionOptions = {}): WordStats {
  ensureProgressInitialized();
  const studyDate = today();
  const filter = wordFilterSql(options, "w");
  const total = firstValue<number>(`SELECT COUNT(*) FROM words w WHERE 1 = 1 ${filter.clause}`, filter.params, 0);
  const knownForever = firstValue<number>(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 1 ${filter.clause}
  `, filter.params, 0);
  const reviewedToday = firstValue<number>("SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ?", [studyDate], 0);
  const lowCount = firstValue<number>(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND p.seen_count > 0 AND p.score <= 6 ${filter.clause}
  `, filter.params, 0);
  const unseenCount = firstValue<number>(
    `
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND p.seen_count = 0 ${filter.clause}
    `,
    filter.params,
    0
  );
  const stage1Progress = stage1ProgressCounts();
  const stage2 = stage2Stats();
  const kanji = kanjiStats();
  const checkinRows = getDatabase().exec("SELECT checked_on FROM checkins ORDER BY checked_on");
  const checkins = checkinRows.length ? checkinRows[0].values.map((row) => String(row[0])) : [];
  const wordStudySecondsToday = firstValue<number>(
    "SELECT seconds FROM word_study_time WHERE studied_on = ?",
    [studyDate],
    0
  );

  return {
    total,
    knownForever,
    masteredToday: firstValue<number>(
      "SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ? AND score_after >= 10",
      [studyDate],
      0
    ),
    reviewedToday,
    lowCount,
    unseenCount,
    newToday: firstValue<number>(
      `
      SELECT COUNT(DISTINCT today_reviews.word_id)
      FROM reviews today_reviews
      WHERE today_reviews.reviewed_on = ?
        AND NOT EXISTS (
          SELECT 1
          FROM reviews earlier_reviews
          WHERE earlier_reviews.word_id = today_reviews.word_id
            AND earlier_reviews.reviewed_on < ?
        )
      `,
      [studyDate, studyDate],
      0
    ),
    oldToday: Math.max(0, reviewedToday - firstValue<number>(
      `
      SELECT COUNT(DISTINCT today_reviews.word_id)
      FROM reviews today_reviews
      WHERE today_reviews.reviewed_on = ?
        AND NOT EXISTS (
          SELECT 1
          FROM reviews earlier_reviews
          WHERE earlier_reviews.word_id = today_reviews.word_id
            AND earlier_reviews.reviewed_on < ?
        )
      `,
      [studyDate, studyDate],
      0
    )),
    newQuota: dailyNewQuota(),
    stage1ProgressDone: stage1Progress.completed,
    stage1ProgressTotal: stage1Progress.total,
    phase,
    stage1Done: stage1Progress.total > 0 && stage1Progress.completed >= stage1Progress.total,
    stage2Total: stage2.total,
    stage2Completed: stage2.completed,
    kanjiTotal: kanji.total,
    kanjiCompleted: kanji.completed,
    studyDate,
    checkins,
    dailyStudyStats: dailyStudyStats(),
    wordStudySecondsToday,
    taskDone: kanji.total > 0
      ? kanji.completed >= kanji.total
      : stage2.total > 0
        ? stage2.completed >= stage2.total
        : stage1Progress.completed >= stage1Progress.total
  };
}

export function refreshTodayWordPlan(): WordStats {
  ensureProgressInitialized();
  const day = today();
  const reviewedToday = firstValue<number>("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?", [day], 0);
  if (reviewedToday === 0) {
    getDatabase().run("DELETE FROM stage1_tasks WHERE reviewed_on = ?", [day]);
    createStage1Tasks(day);
  }
  return getWordStats(currentPhase());
}

export function completeTodayWordPlan(): { stats: WordStats; completedCount: number } {
  ensureProgressInitialized();
  const day = today();
  ensureStage1Tasks();
  const rows = rowsFor(`
    SELECT t.word_id, p.score
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND p.score <= 6
  `, [day]);
  const ids = rows.map((row) => Number(row.word_id)).filter((id) => Number.isFinite(id));

  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    getDatabase().run(`
      UPDATE progress
      SET score = MAX(score, 10),
          seen_count = seen_count + 1,
          mastered_on = COALESCE(mastered_on, ?),
          last_seen_on = ?,
          right_count = right_count + 1,
          mistake_streak = 0
      WHERE word_id IN (${placeholders})
        AND known_forever = 0
    `, [day, day, ...ids]);

    getDatabase().run(`
      INSERT INTO reviews (word_id, answer, score_after, reviewed_on)
      SELECT t.word_id, 'know', 10, ?
      FROM stage1_tasks t
      WHERE t.reviewed_on = ?
        AND t.word_id IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM reviews r
          WHERE r.word_id = t.word_id
            AND r.reviewed_on = ?
        )
    `, [day, day, ...ids, day]);

    setReviewQueue(getReviewQueue().filter((item) => !ids.includes(item.word_id)));
  }

  getDatabase().run(`
    UPDATE stage2_progress
    SET temp_score = MAX(temp_score, 10),
        completed = 1,
        due_after = NULL
    WHERE reviewed_on = ?
  `, [day]);
  getDatabase().run(`
    UPDATE kanji_progress
    SET temp_score = MAX(temp_score, 10),
        completed = 1,
        due_after = NULL
    WHERE reviewed_on = ?
  `, [day]);

  recordCheckin();
  setPhase("done");
  persistSoon();
  return { stats: getWordStats("done"), completedCount: ids.length };
}

export function getNextWordCard(options: WordSessionOptions = {}): WordCard | null {
  ensureProgressInitialized();
  return nextCard(options).card;
}

export function getWordSession(options: WordSessionOptions = {}): WordSessionResponse {
  ensureProgressInitialized();
  const { card, phase } = nextCard(options);
  return {
    card,
    phase,
    stats: getWordStats(phase, options)
  };
}

export function continueStage2Study(): WordSessionResponse {
  ensureProgressInitialized();
  const stage2 = stage2Stats();
  if (stage2.total > 0 && stage2.completed < stage2.total) {
    setPhase("stage2");
    return getWordSession();
  }
  setPhase("done");
  return getWordSession();
}

export function continueKanjiStudy(): WordSessionResponse {
  ensureProgressInitialized();
  buildKanjiProgressFromReviews();
  const kanji = kanjiStats();
  if (kanji.total > 0 && kanji.completed < kanji.total) {
    setPhase("kanji");
    return getWordSession();
  }
  setPhase("done");
  return getWordSession();
}

export function submitWordAnswer(wordId: number, answer: WordAnswer, options: WordSessionOptions = {}): WordSessionResponse {
  ensureProgressInitialized();
  if (!claimCurrentCard(wordId)) {
    // Stale or duplicate submission (e.g. a rapid double-tap before the card
    // advanced). Do NOT score the word again; just re-sync with the current card.
    return getWordSession(options);
  }
  const db = getDatabase();
  const studyDate = today();
  const phase = currentPhase();

  if (phase === "stage2") {
    const current = firstRow("SELECT * FROM stage2_progress WHERE reviewed_on = ? AND word_id = ?", [studyDate, wordId]);
    if (!current) return getWordSession(options);
    advanceStage2Queue(wordId);
    const snapshot = {
      phase: "stage2",
      reviewed_on: studyDate,
      word_id: wordId,
      temp_score: Number(current.temp_score ?? 0),
      seen_count: Number(current.seen_count ?? 0),
      completed: Number(current.completed ?? 0),
      due_after: current.due_after
    };
    const tempScore = Math.max(Number(current.temp_score ?? 0) + answerScore[answer], -40);
    const completed = tempScore >= 10 ? 1 : 0;
    const dueAfter = completed ? null : randomBetween(4, 8);
    db.run(`
      UPDATE stage2_progress
      SET temp_score = ?, seen_count = seen_count + 1,
          completed = ?, due_after = ?
      WHERE reviewed_on = ? AND word_id = ?
    `, [tempScore, completed, dueAfter, studyDate, wordId]);
    setState("last_answer", JSON.stringify(snapshot));
    import("./storage").then(({ scheduleSave }) => scheduleSave());
    return getWordSession(options);
  }

  if (phase === "kanji") {
    const current = firstRow("SELECT * FROM kanji_progress WHERE reviewed_on = ? AND word_id = ?", [studyDate, wordId]);
    if (!current) return getWordSession(options);
    const memory = firstRow("SELECT * FROM kanji_memory WHERE word_id = ?", [wordId]);
    advanceKanjiQueue(wordId);
    const snapshot = {
      phase: "kanji",
      reviewed_on: studyDate,
      word_id: wordId,
      temp_score: Number(current.temp_score ?? 0),
      seen_count: Number(current.seen_count ?? 0),
      completed: Number(current.completed ?? 0),
      due_after: current.due_after,
      memory_exists: Boolean(memory),
      memory_score: Number(memory?.score ?? 0),
      memory_seen_count: Number(memory?.seen_count ?? 0),
      memory_right_count: Number(memory?.right_count ?? 0),
      memory_fuzzy_count: Number(memory?.fuzzy_count ?? 0),
      memory_forgot_count: Number(memory?.forgot_count ?? 0),
      memory_low_history: Number(memory?.low_history ?? 0),
      memory_last_seen_on: memory?.last_seen_on ?? null
    };
    const delta = answerScore[answer];
    const tempScore = Math.max(Number(current.temp_score ?? 0) + delta, -40);
    const memoryScore = Math.max(Number(memory?.score ?? 0) + delta, -40);
    const completed = tempScore >= 10 ? 1 : 0;
    const lowHistory = memoryScore <= CRITICAL_SCORE || Number(memory?.low_history ?? 0) ? 1 : 0;
    const dueAfter = completed ? null : tempScore <= CRITICAL_SCORE ? randomBetween(2, 4) : randomBetween(4, 8);
    db.run(`
      UPDATE kanji_progress
      SET temp_score = ?, seen_count = seen_count + 1,
          completed = ?, due_after = ?
      WHERE reviewed_on = ? AND word_id = ?
    `, [tempScore, completed, dueAfter, studyDate, wordId]);
    db.run(`
      INSERT INTO kanji_memory (
        word_id, score, seen_count, right_count,
        fuzzy_count, forgot_count, low_history, last_seen_on
      )
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
        score = excluded.score,
        seen_count = kanji_memory.seen_count + 1,
        right_count = kanji_memory.right_count + excluded.right_count,
        fuzzy_count = kanji_memory.fuzzy_count + excluded.fuzzy_count,
        forgot_count = kanji_memory.forgot_count + excluded.forgot_count,
        low_history = MAX(kanji_memory.low_history, excluded.low_history),
        last_seen_on = excluded.last_seen_on
    `, [
      wordId,
      memoryScore,
      answer === "know" || answer === "known_forever" ? 1 : 0,
      answer === "fuzzy" ? 1 : 0,
      answer === "forgot" ? 1 : 0,
      lowHistory,
      studyDate
    ]);
    setState("last_answer", JSON.stringify(snapshot));
    import("./storage").then(({ scheduleSave }) => scheduleSave());
    return getWordSession(options);
  }

  const progress = firstRow("SELECT * FROM progress WHERE word_id = ?", [wordId]);
  if (!progress) return getWordSession(options);
  const snapshot = {
    phase: "stage1",
    word_id: wordId,
    score: Number(progress.score ?? 0),
    seen_count: Number(progress.seen_count ?? 0),
    low_history: Number(progress.low_history ?? 0),
    known_forever: Number(progress.known_forever ?? 0),
    mastered_on: progress.mastered_on,
    last_seen_on: progress.last_seen_on,
    right_count: Number(progress.right_count ?? 0),
    fuzzy_count: Number(progress.fuzzy_count ?? 0),
    forgot_count: Number(progress.forgot_count ?? 0),
    mistake_streak: Number(progress.mistake_streak ?? 0),
    review_queue: getReviewQueue()
  };

  advanceReviewQueue(wordId);
  let score = Number(progress.score ?? 0);
  let knownForever = Number(progress.known_forever ?? 0);
  let rightCount = Number(progress.right_count ?? 0);
  let fuzzyCount = Number(progress.fuzzy_count ?? 0);
  let forgotCount = Number(progress.forgot_count ?? 0);
  let mistakeStreak = Number(progress.mistake_streak ?? 0);

  if (answer === "known_forever") {
    knownForever = 1;
    mistakeStreak = 0;
  } else {
    // First "know" of the day on a word earns a +5 first-impression bonus
    // (+15 instead of +10). Only the day's first sighting counts; fuzzy/forgot
    // and later sightings are unchanged.
    const firstSeenToday =
      firstValue<number>("SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ?", [wordId, studyDate], 0) === 0;
    const delta = answer === "know" && firstSeenToday ? 15 : answerScore[answer];
    score = Math.max(score + delta, -40);
    rightCount += answer === "know" ? 1 : 0;
    fuzzyCount += answer === "fuzzy" ? 1 : 0;
    forgotCount += answer === "forgot" ? 1 : 0;
    mistakeStreak = answer === "know" ? 0 : mistakeStreak + 1;
  }

  let lowHistory = Number(progress.low_history ?? 0);
  if (score <= CRITICAL_SCORE) lowHistory = 1;
  if (score <= CRITICAL_SCORE && !knownForever) {
    db.run("INSERT OR IGNORE INTO critical_reviews (reviewed_on, word_id) VALUES (?, ?)", [studyDate, wordId]);
  }
  const masteredOn = score >= 10 && !knownForever ? studyDate : null;
  if (score <= 6 && !knownForever) scheduleDelayedReview(wordId);
  if (answer !== "known_forever") recordStage2Word(wordId);

  db.run(`
    UPDATE progress
    SET score = ?,
        seen_count = seen_count + 1,
        low_history = ?,
        known_forever = ?,
        mastered_on = ?,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?
    WHERE word_id = ?
  `, [score, lowHistory, knownForever, masteredOn, studyDate, rightCount, fuzzyCount, forgotCount, mistakeStreak, wordId]);

  db.run(
    "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
    [wordId, answer, score, studyDate]
  );
  const reviewId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
  setState("last_answer", JSON.stringify({ ...snapshot, review_id: reviewId }));

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  return getWordSession(options);
}

export function undoLastWordAnswer(): WordSessionResponse {
  ensureProgressInitialized();
  const db = getDatabase();
  const rawSnapshot = getState("last_answer", "");
  if (!rawSnapshot) return getWordSession();

  let snapshot: Record<string, unknown>;
  try {
    snapshot = JSON.parse(rawSnapshot) as Record<string, unknown>;
  } catch {
    return getWordSession();
  }

  if (snapshot.phase === "stage2") {
    db.run(`
      UPDATE stage2_progress
      SET temp_score = ?, seen_count = ?, completed = ?, due_after = ?
      WHERE reviewed_on = ? AND word_id = ?
    `, [
      Number(snapshot.temp_score ?? 0),
      Number(snapshot.seen_count ?? 0),
      Number(snapshot.completed ?? 0),
      snapshot.due_after == null ? null : Number(snapshot.due_after),
      String(snapshot.reviewed_on ?? today()),
      Number(snapshot.word_id)
    ]);
    setPhase("stage2");
  } else if (snapshot.phase === "kanji") {
    db.run(`
      UPDATE kanji_progress
      SET temp_score = ?, seen_count = ?, completed = ?, due_after = ?
      WHERE reviewed_on = ? AND word_id = ?
    `, [
      Number(snapshot.temp_score ?? 0),
      Number(snapshot.seen_count ?? 0),
      Number(snapshot.completed ?? 0),
      snapshot.due_after == null ? null : Number(snapshot.due_after),
      String(snapshot.reviewed_on ?? today()),
      Number(snapshot.word_id)
    ]);
    if (snapshot.memory_exists) {
      db.run(`
        INSERT INTO kanji_memory (
          word_id, score, seen_count, right_count,
          fuzzy_count, forgot_count, low_history, last_seen_on
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          score = excluded.score,
          seen_count = excluded.seen_count,
          right_count = excluded.right_count,
          fuzzy_count = excluded.fuzzy_count,
          forgot_count = excluded.forgot_count,
          low_history = excluded.low_history,
          last_seen_on = excluded.last_seen_on
      `, [
        Number(snapshot.word_id),
        Number(snapshot.memory_score ?? 0),
        Number(snapshot.memory_seen_count ?? 0),
        Number(snapshot.memory_right_count ?? 0),
        Number(snapshot.memory_fuzzy_count ?? 0),
        Number(snapshot.memory_forgot_count ?? 0),
        Number(snapshot.memory_low_history ?? 0),
        snapshot.memory_last_seen_on == null ? null : String(snapshot.memory_last_seen_on)
      ]);
    } else {
      db.run("DELETE FROM kanji_memory WHERE word_id = ?", [Number(snapshot.word_id)]);
    }
    setPhase("kanji");
  } else if (snapshot.phase === "stage1") {
    db.run(`
      UPDATE progress
      SET score = ?,
          seen_count = ?,
          low_history = ?,
          known_forever = ?,
          mastered_on = ?,
          last_seen_on = ?,
          right_count = ?,
          fuzzy_count = ?,
          forgot_count = ?,
          mistake_streak = ?
      WHERE word_id = ?
    `, [
      Number(snapshot.score ?? 0),
      Number(snapshot.seen_count ?? 0),
      Number(snapshot.low_history ?? 0),
      Number(snapshot.known_forever ?? 0),
      snapshot.mastered_on == null ? null : String(snapshot.mastered_on),
      snapshot.last_seen_on == null ? null : String(snapshot.last_seen_on),
      Number(snapshot.right_count ?? 0),
      Number(snapshot.fuzzy_count ?? 0),
      Number(snapshot.forgot_count ?? 0),
      Number(snapshot.mistake_streak ?? 0),
      Number(snapshot.word_id)
    ]);
    if (snapshot.review_id != null) {
      db.run("DELETE FROM reviews WHERE id = ?", [Number(snapshot.review_id)]);
    }
    if (Array.isArray(snapshot.review_queue)) {
      setReviewQueue(snapshot.review_queue.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const wordId = Number(record.word_id);
        if (!Number.isFinite(wordId)) return [];
        return [{ word_id: wordId, due_after: Math.max(Number(record.due_after ?? 0), 0) }];
      }));
    }
    setPhase("stage1");
  }

  setState("last_answer", "");

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  return getWordSession();
}

export function updateWordNote(wordId: number, note: string): { wordId: number; note: string } {
  const db = getDatabase();
  const cleaned = note.trim();
  if (cleaned) {
    db.run(
      "INSERT OR REPLACE INTO word_notes (word_id, note, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
      [wordId, cleaned]
    );
  } else {
    db.run("DELETE FROM word_notes WHERE word_id = ?", [wordId]);
  }

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  return { wordId, note: cleaned };
}

export function addWordStudySeconds(seconds: number): { seconds: number; stats: WordStats } {
  const db = getDatabase();
  const studyDate = today();
  db.run(`
    INSERT INTO word_study_time (studied_on, seconds, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(studied_on) DO UPDATE SET
      seconds = seconds + excluded.seconds,
      updated_at = CURRENT_TIMESTAMP
  `, [studyDate, Math.max(0, Math.round(seconds))]);

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  return {
    seconds,
    stats: getWordStats("stage1")
  };
}
