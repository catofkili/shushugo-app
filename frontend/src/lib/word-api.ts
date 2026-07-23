import { getDatabase } from "./database";
import { WordAnswer, WordCard, WordSessionResponse, WordStats } from "../types/vocabulary";
import { getDailyWordGoal, getReviewCapPreference } from "./studyPreferences";
import { hasKanjiText, rowObjectToCard } from "./models/word-card";
import { notifyProgressUpdated } from "./progress-events";
import {
  pickDueCriticalPoolRow,
  pickStage1CriticalPoolRow,
  priorityComponents,
  priorityScore,
  shouldPickStage1NewWord
} from "./scheduler/priority";
import {
  answerScore,
  CRITICAL_SCORE,
  daysSince,
  DbRow,
  ensureUserTables,
  firstRow,
  firstValue,
  getState,
  persistSoon,
  randomBetween,
  rowsFor,
  setState,
  SqlValue,
  studyDayEnd,
  today
} from "./study-core";
import type { WordSessionOptions } from "./study-types";
import {
  applyLadderDecay,
  ladderDecayRate,
  nextRightStreak,
  RETIRED_SPOT_CHECKS_PER_DAY,
  SCORE_CAP,
  shouldAutoRetire
} from "./streak-ladder";
import { applyGrammarDailyDecay, ensureGrammarProgressInitialized } from "./grammar-api";
import {
  comebackDailyTarget,
  currentComeback,
  dailyReviewCap,
  encoreChunkSize,
  estimatedMinutesFor,
  evaluateComeback,
  fatigueDetected,
  markComebackAnnouncedOn,
  readEncoreLog,
  recentReviewAverages,
  recordEncore,
  retuneComebackMode,
  reviewBacklogCount
} from "./comeback";
import type { ComebackMode } from "./comeback";
import { ensureFsrsColumns, backfillFsrsFromHistory, recordFsrsReview, isFsrsActive, fsrsDueWordIds } from "./fsrs-store";
import { isGraduatedForDay } from "./fsrs-scheduler";

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
  // 种子数据迁移已在启动时(main.tsx 的 ensureSeedData)完成。
  ensureUserTables();
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
  // 阶段 P0(影子模式):建 FSRS 列并把历史一次性回填。只写不读,零可见变化。
  try {
    ensureFsrsColumns();
    backfillFsrsFromHistory();
  } catch (err) {
    console.warn("[fsrs] 回填跳过:", err);
  }
};

const ladderRowOf = (row: DbRow) => ({
  importance: Number(row.importance ?? 3),
  right_count: Number(row.right_count ?? 0),
  fuzzy_count: Number(row.fuzzy_count ?? 0),
  forgot_count: Number(row.forgot_count ?? 0),
  right_streak: Number(row.right_streak ?? 0)
});

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
  // 老算法已关闭:FSRS 生效时不再跑每日分数衰减(score 不再被读,衰减纯属空转且会一夜灌爆积压)。
  if (isFsrsActive()) return;
  const day = today();
  const lastDecay = getState("last_decay", "");
  if (!lastDecay) {
    setState("last_decay", day);
    return;
  }
  if (lastDecay === day) return;
  // 隔多天打开也按实际天数补衰减(封顶 60,防异常日期)
  const steps = Math.min(Math.max(daysSince(lastDecay), 1), 60);

  const db = getDatabase();
  const rows = rowsFor(`
    SELECT w.importance, p.*
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND p.seen_count > 0
  `);

  rows.forEach((row) => {
    const rate = ladderDecayRate(ladderRowOf(row));
    const next = applyLadderDecay(Number(row.score ?? 0), rate * steps);
    db.run(`
      UPDATE progress
      SET score = ?,
          mastered_on = NULL,
          last_decay_amount = ?
      WHERE word_id = ?
    `, [next, Math.round(rate * 10), Number(row.word_id)]);
  });

  backfillCriticalReviews(day);
  resetPreviousCriticalReviews(day);
  setState("last_decay", day);
};

const dailyNewQuota = () => {
  // 回归模式期间暂停引入新词，先清积压
  if (currentComeback()) return 0;
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
  // 过几张卡后再出(≤10,随机):没记住的词当场反复,直到毕业
  queue.push({ word_id: wordId, due_after: randomBetween(3, 10) });
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

const stage1NewTaskCount = (day: string) => firstValue<number>(
  "SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'new'",
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
  }

  activateMojiMigratedReviews(day);

  // 退休抽查:每天临时复活最少见的几个自动退休词(known_forever=0、score=6),
  // 它们自然流入下方的复习选取;答对会被梯子规则当场重新退休,答错则留在轮换里。
  // 手动「熟知」的词没有 auto_retired_on 标记,永不抽查。
  getDatabase().run(`
    UPDATE progress
    SET known_forever = 0, score = 6
    WHERE word_id IN (
      SELECT word_id FROM progress
      WHERE known_forever = 1
        AND auto_retired_on IS NOT NULL
        AND auto_retired_on < ?
      ORDER BY COALESCE(last_seen_on, '') ASC, word_id ASC
      LIMIT ${RETIRED_SPOT_CHECKS_PER_DAY}
    )
  `, [day]);

  // 回归模式评估只发生在当日任务创建前：激活后当天复习量被容量截断，
  // 其余积压自然留给后续天（LIMIT -1 表示不限制）。
  const comeback = evaluateComeback(day);
  const existingReviewTasks = firstValue<number>(
    "SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'review'",
    [day],
    0
  );
  // 复习上限常驻生效;回归模式改用「今日摊还目标」(温和递增/高强度分摊),
  // 高强度可高于常规上限(就是要快清),温和则明显更低。
  const cap = dailyReviewCap(getReviewCapPreference(), day);
  let dailyLimit = cap;
  if (comeback.active) {
    const dayIndex = daysSince(comeback.startedOn) + 1;
    dailyLimit = comebackDailyTarget(comeback, dayIndex, reviewBacklogCount());
  }
  const reviewLimit = Math.max(dailyLimit - existingReviewTasks, 0);

  let orderIndex = 1;
  // 阶段 P1:开关打开时按 FSRS 到期(due 升序)选词,否则走现行分数排序。
  const reviewRows = isFsrsActive()
    ? fsrsDueWordIds(reviewLimit, studyDayEnd()).map((word_id) => ({ word_id }))
    : rowsFor(`
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
    LIMIT ?
  `, [reviewLimit]);

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
  `, [Math.max(dailyNewQuota() - stage1NewTaskCount(day), 0)]);

  newRows.forEach((row) => {
    db.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'new', ?)
    `, [day, Number(row.word_id), orderIndex]);
    orderIndex += 1;
  });
};

const reconcileStage1NewQuota = (day: string) => {
  const completedNewTasks = firstValue<number>(`
    SELECT COUNT(*)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND t.task_type = 'new'
      AND (p.seen_count > 0 OR p.known_forever = 1)
  `, [day], 0);
  const remainingNewQuota = Math.max(dailyNewQuota() - completedNewTasks, 0);

  getDatabase().run(`
    DELETE FROM stage1_tasks
    WHERE reviewed_on = ?
      AND task_type = 'new'
      AND word_id IN (
        SELECT word_id
        FROM (
          SELECT
            t.word_id,
            ROW_NUMBER() OVER (ORDER BY t.order_index ASC, t.word_id ASC) AS row_number
          FROM stage1_tasks t
          JOIN progress p ON p.word_id = t.word_id
          WHERE t.reviewed_on = ?
            AND t.task_type = 'new'
            AND p.seen_count = 0
            AND p.known_forever = 0
        )
        WHERE row_number > ?
      )
  `, [day, day, remainingNewQuota]);
};

const STAGE1_PLAN_VERSION = "review-first-random-v3";

const resetUnansweredStage1PlanForVersion = (day: string) => {
  if (getState("stage1_plan_version", "") === STAGE1_PLAN_VERSION) return;
  const answeredTaskCount = firstValue<number>(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN stage1_tasks t ON t.word_id = r.word_id AND t.reviewed_on = r.reviewed_on
    WHERE t.reviewed_on = ?
  `, [day], 0);
  if (answeredTaskCount === 0) {
    getDatabase().run("DELETE FROM stage1_tasks WHERE reviewed_on = ?", [day]);
    setReviewQueue([]);
    setState("current_card", "0");
  }
  setState("stage1_plan_version", STAGE1_PLAN_VERSION);
};

const ensureStage1Tasks = () => {
  const day = today();
  resetUnansweredStage1PlanForVersion(day);
  createStage1Tasks(day);
  reconcileStage1NewQuota(day);
};

const stage1ProgressCounts = () => {
  const day = today();
  ensureStage1Tasks();
  const total = stage1TaskCount(day);
  // FSRS:「今天毕业」才算完成 = 下次到期已排到本学习日结束之后(不再当天重刷),或永久掌握。
  //   学习/重学中的词(答错、新词没走完步骤)due 只排到几分钟后 → 未毕业 → 不计入完成、当天继续出。
  // 旧算法:分数 >6 才算完成。
  const completed = isFsrsActive()
    ? firstValue<number>(`
        SELECT COUNT(DISTINCT t.word_id)
        FROM stage1_tasks t
        JOIN progress p ON p.word_id = t.word_id
        WHERE t.reviewed_on = ?
          AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
      `, [day, studyDayEnd().toISOString()], 0)
    : firstValue<number>(`
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

// 今日任务之外仍在积压中的复习词数（回归模式下的「待清余量」）
const encoreRemainingCount = (day: string) => firstValue<number>(`
  SELECT COUNT(*)
  FROM progress p
  WHERE p.known_forever = 0
    AND p.seen_count > 0
    AND p.score <= 6
    AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
`, [day], 0);

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
      AND ${isFsrsActive()
        // FSRS:凡「本学习日内仍到期」的都要出——包括还没答的、以及答错/新词学习中
        // (被排到几分钟后、仍 ≤ 今日边界)的。毕业(due 排到明天+)才移出当天。
        ? "(p.fsrs_due IS NULL OR p.fsrs_due <= ?)"
        : "p.score <= 6"}
  `, isFsrsActive() ? [day, studyDayEnd().toISOString()] : [day]);

  const reviewRows = rows.filter((row) => String(row.task_type) === "review");
  const newRows = rows.filter((row) => String(row.task_type) === "new");
  const completedTaskCount = firstValue<number>(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN stage1_tasks t ON t.word_id = r.word_id AND t.reviewed_on = r.reviewed_on
    WHERE t.reviewed_on = ?
  `, [day], 0);
  const criticalPoolRow = pickStage1CriticalPoolRow(reviewRows, queueById);
  if (criticalPoolRow) return rowObjectToCard(criticalPoolRow);

  const preferredRows = shouldPickStage1NewWord(
    reviewRows.length,
    newRows.length,
    completedTaskCount
  ) ? newRows : reviewRows.length ? reviewRows : newRows;
  const candidates = preferredRows.map((row) => {
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

  const comebackState = currentComeback(studyDate);
  const remainingBacklog = encoreRemainingCount(studyDate);
  const { secondsPerWord: recentSecondsPerWord } = recentReviewAverages(studyDate);
  // 估算耗时优先用今天的实际节奏（含反向/汉字阶段的开销），没有数据再退回近期均值
  const secondsPerWord = reviewedToday > 0 && wordStudySecondsToday > 0
    ? Math.min(Math.max(wordStudySecondsToday / reviewedToday, 6), 60)
    : recentSecondsPerWord;
  // 优先清积压(递减批);积压见底后用新词续杯 = 强度的一半(最少 5),
  // 白天已学一份强度,加餐给半份,防一天吞两倍新词把明天复习堆爆。
  const backlogChunk = encoreChunkSize(remainingBacklog);
  const newWordChunk = Math.max(Math.round(getDailyWordGoal() / 2), 5);
  const encoreSize = backlogChunk > 0 ? backlogChunk : Math.min(newWordChunk, unseenCount);
  const encoreLog = readEncoreLog(studyDate);
  const totalLearnedWords = firstValue<number>(
    "SELECT COUNT(*) FROM progress WHERE seen_count > 0 OR known_forever = 1", [], 0
  );
  const comebackDayIndex = comebackState ? daysSince(comebackState.startedOn) + 1 : 0;

  return {
    comeback: comebackState ? {
      active: true,
      dayIndex: comebackDayIndex,
      // 触发时锁定,只减不增;超期(dayIndex 越过计划)显示实际天数,不再逐日 +1 谎报
      planDays: comebackState.planDays,
      mode: comebackState.mode,
      todayTarget: stage1Progress.total,
      estimatedMinutes: estimatedMinutesFor(stage1Progress.total, secondsPerWord),
      remainingBacklog,
      initialBacklog: comebackState.initialBacklog,
      announcedToday: comebackState.announcedOn === studyDate
    } : undefined,
    encore: {
      available: encoreSize > 0,
      size: encoreSize,
      estimatedMinutes: estimatedMinutesFor(encoreSize, secondsPerWord),
      remaining: remainingBacklog,
      unseenRemaining: unseenCount,
      secondsPerWord,
      totalLearned: totalLearnedWords,
      weekEncoreCount: encoreLog.weekCount,
      todayEncoreWords: encoreLog.dayWords,
      fatigued: fatigueDetected(studyDate)
    },
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
  const phase = currentPhase();
  const stage1 = stage1ProgressCounts();
  if (phase === "stage1" && stage1.completed < stage1.total) {
    getDatabase().run("DELETE FROM stage1_tasks WHERE reviewed_on = ?", [day]);
    createStage1Tasks(day);
  }
  notifyProgressUpdated();
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
    // 与 answerWord 的「首见答对」同规则:+15 封顶 20、非深坑词连胜 +1;
    // 但一键完成是快捷通道,不参与自动退休(退休只能靠真实作答攒出来)。
    // MAX(…, 10) 保证深坑词也算完成今日任务,维持本函数「清空今日计划」的契约。
    getDatabase().run(`
      UPDATE progress
      SET score = MIN(MAX(score + 15, 10), ${SCORE_CAP}),
          right_streak = CASE WHEN score >= 0 THEN right_streak + 1 ELSE right_streak END,
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
  notifyProgressUpdated();
  return { stats: getWordStats("done"), completedCount: ids.length };
}

export function markTodayWordCheckin(): WordStats {
  ensureProgressInitialized();
  recordCheckin();
  persistSoon();
  notifyProgressUpdated();
  return getWordStats(currentPhase());
}

export function markComebackAnnounced(): WordStats {
  ensureProgressInitialized();
  markComebackAnnouncedOn(today());
  persistSoon();
  return getWordStats(currentPhase());
}

/**
 * 回归进行中当场切换节奏（欢迎卡上的 🌱/⚡）：重算 planDays，
 * 并按新档位重建当天复习任务（未完成时才重建，避免丢已答进度）。
 */
export function setComebackModeForToday(mode: ComebackMode): WordStats {
  ensureProgressInitialized();
  retuneComebackMode(mode);
  const stats = refreshTodayWordPlan();
  persistSoon();
  return stats;
}

/**
 * 续杯：今日计划完成后，从积压里按遗忘风险再取一小批（递减批量）
 * 加入今日任务并回到 Stage1 继续学。
 */
export function startComebackEncore(customSize?: number): WordSessionResponse {
  ensureProgressInitialized();
  const day = today();
  ensureStage1Tasks();
  const smartSize = encoreChunkSize(encoreRemainingCount(day));
  const size = customSize && customSize > 0
    ? Math.min(Math.round(customSize), 100)
    : (smartSize > 0 ? smartSize : Math.max(Math.round(getDailyWordGoal() / 2), 5));
  if (size <= 0) return getWordSession();

  const db = getDatabase();
  const startIndex = firstValue<number>(
    "SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",
    [day],
    1
  );
  const reviewRows = rowsFor(`
    SELECT p.word_id
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= 6
      AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
    ORDER BY
      p.score ASC,
      p.low_history DESC,
      w.importance DESC,
      p.last_seen_on ASC,
      p.word_id ASC
    LIMIT ?
  `, [day, size]);
  reviewRows.forEach((row, index) => {
    db.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'review', ?)
    `, [day, Number(row.word_id), startIndex + index]);
  });

  // 积压不够就用新词补齐,让「继续学习」在清完积压后依然可用
  const newFill = size - reviewRows.length;
  if (newFill > 0) {
    const newRows = rowsFor(`
      SELECT p.word_id
      FROM progress p
      JOIN words w ON w.id = p.word_id
      WHERE p.known_forever = 0
        AND p.seen_count = 0
        AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
      ORDER BY w.shuffle_rank DESC, w.importance DESC, p.word_id ASC
      LIMIT ?
    `, [day, newFill]);
    // task_type 用 'encore_new' 而不是 'new':加餐词有意超出每日配额,
    // 不能被 reconcileStage1NewQuota 的超额裁剪删掉,也不占配额计数。
    newRows.forEach((row, index) => {
      db.run(`
        INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
        VALUES (?, ?, 'encore_new', ?)
      `, [day, Number(row.word_id), startIndex + reviewRows.length + index]);
    });
    if (reviewRows.length + newRows.length > 0) {
      recordEncore(day, reviewRows.length + newRows.length);
    }
  } else if (reviewRows.length > 0) {
    recordEncore(day, reviewRows.length);
  }

  setPhase("stage1");
  persistSoon();
  notifyProgressUpdated();
  return getWordSession();
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
    notifyProgressUpdated();
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
    notifyProgressUpdated();
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
    right_streak: Number(progress.right_streak ?? 0),
    auto_retired_on: progress.auto_retired_on ?? null,
    review_queue: getReviewQueue()
  };

  advanceReviewQueue(wordId);
  const preScore = Number(progress.score ?? 0);
  let score = preScore;
  let knownForever = Number(progress.known_forever ?? 0);
  let rightCount = Number(progress.right_count ?? 0);
  let fuzzyCount = Number(progress.fuzzy_count ?? 0);
  let forgotCount = Number(progress.forgot_count ?? 0);
  let mistakeStreak = Number(progress.mistake_streak ?? 0);
  let rightStreak = Number(progress.right_streak ?? 0);
  let autoRetiredOn = progress.auto_retired_on == null ? null : String(progress.auto_retired_on);

  if (answer === "known_forever") {
    knownForever = 1;
    mistakeStreak = 0;
    // 手动熟知 = 永久退休,不参与抽查
    autoRetiredOn = null;
  } else {
    // First "know" of the day on a word earns a +5 first-impression bonus
    // (+15 instead of +10). Only the day's first sighting counts; fuzzy/forgot
    // and later sightings are unchanged.
    const firstSeenToday =
      firstValue<number>("SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ?", [wordId, studyDate], 0) === 0;
    const delta = answer === "know" && firstSeenToday ? 15 : answerScore[answer];
    score = Math.min(Math.max(score + delta, -40), SCORE_CAP);
    rightCount += answer === "know" ? 1 : 0;
    fuzzyCount += answer === "fuzzy" ? 1 : 0;
    forgotCount += answer === "forgot" ? 1 : 0;
    mistakeStreak = answer === "know" ? 0 : mistakeStreak + 1;
    rightStreak = nextRightStreak(rightStreak, answer, firstSeenToday, preScore);
  }

  let lowHistory = Number(progress.low_history ?? 0);
  if (score <= CRITICAL_SCORE) lowHistory = 1;
  if (score <= CRITICAL_SCORE && !knownForever) {
    db.run("INSERT OR IGNORE INTO critical_reviews (reviewed_on, word_id) VALUES (?, ?)", [studyDate, wordId]);
  }
  // 连胜攒满自动退休,进抽查池(known_forever + auto_retired_on 标记)
  if (!knownForever && answer === "know" && shouldAutoRetire(rightStreak, score, lowHistory === 1)) {
    knownForever = 1;
    autoRetiredOn = studyDate;
  }
  const masteredOn = score >= 10 && !knownForever ? studyDate : null;

  // FSRS 生效:每次作答都推进学习步骤,再据「是否毕业」决定当天要不要再出。
  // 未毕业(新词/答错,学习或重学中,due 只排到几分钟后)→ 塞回队列过几张再刷;
  // 毕业(due 排到明天及以后)→ 今天不再出。旧算法则沿用「分数 ≤6 未过就重排」。
  let fsrsGraduated = false;
  if (isFsrsActive() && !knownForever) {
    try {
      const next = recordFsrsReview(wordId, answer);
      fsrsGraduated = isGraduatedForDay(next, studyDayEnd());
    } catch (err) {
      console.warn("[fsrs] 记录跳过:", err);
      fsrsGraduated = answer === "know"; // 兜底:认识当作过了
    }
  }
  const notPassed = isFsrsActive() ? !fsrsGraduated : score <= 6;
  if (notPassed && !knownForever) scheduleDelayedReview(wordId);
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
        mistake_streak = ?,
        right_streak = ?,
        auto_retired_on = ?
    WHERE word_id = ?
  `, [score, lowHistory, knownForever, masteredOn, studyDate, rightCount, fuzzyCount, forgotCount, mistakeStreak, rightStreak, autoRetiredOn, wordId]);

  db.run(
    "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
    [wordId, answer, score, studyDate]
  );
  const reviewId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
  setState("last_answer", JSON.stringify({ ...snapshot, review_id: reviewId }));

  // FSRS 未启用时:保留「当日首见」影子写,供切换前对比明日到期数。
  // 已启用时:上面已在每次作答时记录(学习步骤需要每次推进),此处不再重复写。
  if (!isFsrsActive()) {
    try {
      const priorToday = firstValue<number>(
        "SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND id < ?",
        [wordId, studyDate, reviewId],
        0
      );
      if (priorToday === 0) recordFsrsReview(wordId, answer);
    } catch (err) {
      console.warn("[fsrs] 影子写跳过:", err);
    }
  }

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  notifyProgressUpdated();
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
          mistake_streak = ?,
          right_streak = ?,
          auto_retired_on = ?
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
      Number(snapshot.right_streak ?? 0),
      snapshot.auto_retired_on == null ? null : String(snapshot.auto_retired_on),
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
  notifyProgressUpdated();

  // 撤销的语义是「回到刚才那张」，而不是在恢复数据后再随机抽下一张。
  // 重新抽题会让用户看到无关词，也会把 current_card 留在错误的下一题上。
  const restoredRow = firstRow(`
    SELECT
      w.*,
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
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `, [Number(snapshot.word_id)]);
  const restoredCard = restoredRow ? rowObjectToCard(restoredRow) : null;
  if (restoredCard) {
    const restoredPhase = snapshot.phase === "stage2" || snapshot.phase === "kanji" || snapshot.phase === "stage1"
      ? snapshot.phase
      : currentPhase();
    setCurrentCard(restoredCard);
    return {
      card: restoredCard,
      phase: restoredPhase,
      stats: getWordStats(restoredPhase)
    };
  }

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
