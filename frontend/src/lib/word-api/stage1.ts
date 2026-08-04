import { getDatabase } from "../database";
import type { WordCard } from "../../types/vocabulary";
import { getReviewCapPreference } from "../studyPreferences";
import { rowObjectToCard } from "../models/word-card";
import {
  priorityComponents,
  priorityScore,
  shouldPickStage1NewWord
} from "../scheduler/priority";
import { allowsBackToBack, STUBBORN_MISTAKE_STREAK } from "../scheduler/requeue";
import { INTERFERENCE_WINDOW, sessionInterference } from "../scheduler/interference";
import { pickNextInSequence, UNKNOWN_RECALL } from "../scheduler/sequencer";
import {
  firstValue,
  getState,
  rowsFor,
  setState,
  studyDayEnd,
  today
} from "../study-core";
import { dailyReviewCap } from "../review-budget";
import { fsrsDueWordIds, recallFromRow } from "../fsrs-store";
import { LEECH_LAPSE_THRESHOLD } from "../fsrs-scheduler";
import {
  dailyNewQuota,
  getReviewQueue,
  lastAnsweredWord,
  recentAnswersToday,
  setReviewQueue
} from "./session-state";

/** 排片器要的「预测答对概率」;没有调度记录的按中性偏易处理 */
const predictedRecall = (row: Record<string, unknown>): number =>
  recallFromRow(row) ?? UNKNOWN_RECALL;

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
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
    ORDER BY m.priority DESC, p.fsrs_due ASC, w.importance DESC, m.word_id ASC
    LIMIT 30
  `, [studyDayEnd().toISOString()]);

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

  // 不再有「退休抽查」:FSRS 里已掌握的词间隔会自然涨到 180 天以上,
  // 到期了就自己回到轮换里,不需要额外把它们捞出来。

  const existingReviewTasks = firstValue<number>(
    "SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'review'",
    [day],
    0
  );
  // 复习上限是唯一的当日复习量闸门(用户设置优先,0 走自动档)。
  // 超出的到期词顺延到后面几天,由续杯自然消化。
  const dailyLimit = dailyReviewCap(getReviewCapPreference(), day);
  const reviewLimit = Math.max(dailyLimit - existingReviewTasks, 0);

  let orderIndex = 1;
  // 选词只有一条路:FSRS 到期集(刚栽过跟头的优先,其余 due 升序)。
  const reviewRows = fsrsDueWordIds(reviewLimit, studyDayEnd()).map((word_id) => ({ word_id }));

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
  // 「今天毕业」才算完成 = 下次到期已排到本学习日结束之后(不再当天重刷),或手动熟知。
  // 学习/重学中的词(答错、新词没走完步骤)due 只排到几分钟后 → 未毕业 → 当天继续出。
  const completed = firstValue<number>(`
    SELECT COUNT(DISTINCT t.word_id)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
  `, [day, studyDayEnd().toISOString()], 0);

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
    AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
    -- 还没轮到激活的导入词不算积压,否则续杯会把几千个导入词一次性倒出来
    AND p.word_id NOT IN (SELECT word_id FROM moji_migrated_reviews WHERE activated_on IS NULL)
    AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
`, [studyDayEnd().toISOString(), day], 0);

export const pickStage1Next = (excludedIds: Set<number> = new Set()): WordCard | null => {
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
      p.fsrs_due,
      p.fsrs_lapses,
      p.fsrs_state,
      t.task_type,
      t.order_index,
      COALESCE(n.note, '') AS note
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      -- 凡「本学习日内仍到期」的都要出:还没答的、以及答错/新词学习中
      -- (被排到几分钟后、仍 <= 今日边界)的。毕业(due 排到明天+)才移出当天。
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `, [day, studyDayEnd().toISOString()]);

  // 默认规则:刚答过的那张不参与本次抽取(全场只剩它时才让步)。
  // 之前只靠优先级里的 queue 负分压制,末段所有词都在队列里时,刚答错的那张
  // 反而因为「due_after 最小」被顶回来 → 表现为「点不认识,下一张还是它」。
  // 例外(allowsBackToBack):顽固词连着刷、收尾阶段池子太小——这两种情况允许连出。
  const availableRows = rows.filter((row) => !excludedIds.has(Number(row.id)));
  const lastId = lastAnsweredWord();
  const lastRow = availableRows.find((row) => Number(row.id) === lastId);
  const repeatAllowed = allowsBackToBack({
    mistakeStreak: Number(lastRow?.mistake_streak ?? 0),
    remaining: availableRows.length,
    total: stage1TaskCount(day)
  });
  // 顽固词连着错到阈值 → 当场接着刷,这是有意的(越出越密才攻得下来),
  // 不能进排片:排片会把「刚答错的词」当成难词避开,正好把这个机制废掉。
  const stubbornDrill = lastRow
    && Number(lastRow.mistake_streak ?? 0) >= STUBBORN_MISTAKE_STREAK
    && (queueById.get(lastId) ?? 0) <= 0;
  if (stubbornDrill) return rowObjectToCard(lastRow);

  const pickable = availableRows.length > 1 && !repeatAllowed
    ? availableRows.filter((row) => Number(row.id) !== lastId)
    : availableRows;
  const reviewRows = pickable.filter((row) => String(row.task_type) === "review");
  const newRows = pickable.filter((row) => String(row.task_type) === "new");
  const completedTaskCount = firstValue<number>(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN stage1_tasks t ON t.word_id = r.word_id AND t.reviewed_on = r.reviewed_on
    WHERE t.reviewed_on = ?
  `, [day], 0);
  const preferredRows = shouldPickStage1NewWord(
    reviewRows.length,
    newRows.length,
    completedTaskCount
  ) ? newRows : reviewRows.length ? reviewRows : newRows;
  const candidates = preferredRows.map((row) => {
    const dueAfter = queueById.get(Number(row.id)) ?? 0;
    const components = priorityComponents(row, queueById.get(Number(row.id)), newQuotaLeft);
    return {
      score: priorityScore(components),
      dueAfter,
      row
    };
  });
  if (!candidates.length) return null;

  // 「隔几张再出」是硬闸门,不是优先级里的一项负分:排队中的词一律让位给已到位的词。
  // 全都还没轮到(当天剩余卡片比间隔还少)→ 退化成轮转:等得最久的先出,
  // 当天的账当天平掉,不留到明天。
  const ready = candidates.filter((item) => item.dueAfter <= 0);
  if (!ready.length) {
    candidates.sort((left, right) => left.dueAfter - right.dueAfter || right.score - left.score);
    return rowObjectToCard(candidates[0].row);
  }

  // 排片:干扰隔离 / 开场减压 / 连败保护,最后按优先级加权随机。
  const recent = recentAnswersToday(day, INTERFERENCE_WINDOW);
  const byId = new Map(ready.map((item) => [item.row, item]));
  const picked = pickNextInSequence(
    ready.map((item) => ({
      id: Number(item.row.id),
      score: item.score,
      recall: predictedRecall(item.row),
      isLeech: Number(item.row.fsrs_lapses ?? 0) >= LEECH_LAPSE_THRESHOLD
    })),
    {
      answeredToday: recent.answeredToday,
      recentIds: recent.wordIds,
      wrongStreak: recent.wrongStreak,
      interference: sessionInterference(day, rows)
    }
  );
  if (!picked) return null;
  const pickedRow = [...byId.keys()].find((row) => Number(row.id) === picked.id);
  return pickedRow ? rowObjectToCard(pickedRow) : rowObjectToCard(ready[0].row);
};
