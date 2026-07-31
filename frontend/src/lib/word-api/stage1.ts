import { getDatabase } from "../database";
import type { WordCard } from "../../types/vocabulary";
import { getReviewCapPreference } from "../studyPreferences";
import { rowObjectToCard } from "../models/word-card";
import {
  pickStage1CriticalPoolRow,
  priorityComponents,
  priorityScore,
  shouldPickStage1NewWord
} from "../scheduler/priority";
import { allowsBackToBack } from "../scheduler/requeue";
import {
  CRITICAL_SCORE,
  daysSince,
  firstValue,
  getState,
  rowsFor,
  setState,
  studyDayEnd,
  today
} from "../study-core";
import { RETIRED_SPOT_CHECKS_PER_DAY } from "../streak-ladder";
import { comebackDailyTarget, dailyReviewCap, evaluateComeback, reviewBacklogCount } from "../comeback";
import { isFsrsActive, fsrsDueWordIds } from "../fsrs-store";
import { dailyNewQuota, getReviewQueue, lastAnsweredWord, setReviewQueue } from "./session-state";

/**
 * Stage1(当日词表)的「计划」和「出题」。
 *
 * 计划:每天生成一次任务表(复习 + 新词),受复习上限 / 回归模式摊还目标 / 每日新词目标约束,
 *      并负责历史回填、moji 迁移词激活、退休词抽查。
 * 出题:从当日任务里挑下一张——危险池优先,再按优先级打分,
 *      「隔几张再出」是硬闸门(见 requeue.ts),刚答过的那张默认不连出。
 *
 * 从 word-api.ts 原样搬出,逻辑一字未改。
 */

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

export const createStage1Tasks = (day: string) => {
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

export const ensureStage1Tasks = () => {
  const day = today();
  resetUnansweredStage1PlanForVersion(day);
  createStage1Tasks(day);
  reconcileStage1NewQuota(day);
};

export const stage1ProgressCounts = () => {
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
export const encoreRemainingCount = (day: string) => firstValue<number>(`
  SELECT COUNT(*)
  FROM progress p
  WHERE p.known_forever = 0
    AND p.seen_count > 0
    AND p.score <= 6
    AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
`, [day], 0);

export const pickStage1Next = (): WordCard | null => {
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

  // 默认规则:刚答过的那张不参与本次抽取(全场只剩它时才让步)。
  // 之前只靠优先级里的 queue 负分压制,末段所有词都在队列里时,刚答错的那张
  // 反而因为「due_after 最小」被顶回来 → 表现为「点不认识,下一张还是它」。
  // 例外(allowsBackToBack):顽固词连着刷、收尾阶段池子太小——这两种情况允许连出。
  const lastId = lastAnsweredWord();
  const lastRow = rows.find((row) => Number(row.id) === lastId);
  const repeatAllowed = allowsBackToBack({
    mistakeStreak: Number(lastRow?.mistake_streak ?? 0),
    remaining: rows.length,
    total: stage1TaskCount(day)
  });
  const pickable = rows.length > 1 && !repeatAllowed
    ? rows.filter((row) => Number(row.id) !== lastId)
    : rows;
  const reviewRows = pickable.filter((row) => String(row.task_type) === "review");
  const newRows = pickable.filter((row) => String(row.task_type) === "new");
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
    const dueAfter = queueById.get(Number(row.id)) ?? 0;
    const components = priorityComponents(row, queueById.get(Number(row.id)), criticalCount, newQuotaLeft);
    return {
      score: priorityScore(components),
      dueAfter,
      row
    };
  });
  if (!candidates.length) return null;
  // 「隔几张再出」是硬闸门,不是优先级里的一项负分:排队中的词一律让位给已到位的词。
  const ready = candidates.filter((item) => item.dueAfter <= 0);
  if (ready.length) {
    ready.sort((left, right) => right.score - left.score);
    return rowObjectToCard(ready[0].row);
  }
  // 全都还没轮到(当天剩余卡片比间隔还少)→ 退化成轮转:等得最久的先出。
  candidates.sort((left, right) => left.dueAfter - right.dueAfter || right.score - left.score);
  return rowObjectToCard(candidates[0].row);
};
