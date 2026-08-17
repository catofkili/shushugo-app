import { getDatabase } from "../database";
import type { WordCard } from "../../types/vocabulary";
import { rowObjectToCard } from "../models/word-card";
import { getReviewCapPreference } from "../studyPreferences";
import { priorityComponents, priorityScore } from "../scheduler/priority";
import { allowsBackToBack, STUBBORN_MISTAKE_STREAK } from "../scheduler/requeue";
import { INTERFERENCE_WINDOW, sessionInterference } from "../scheduler/interference";
import { pickNextInSequence, UNKNOWN_RECALL } from "../scheduler/sequencer";
import { firstRow, firstValue, rowsFor, studyDayEnd, today } from "../study-core";
import { dailyReviewCap } from "../review-budget";
import { fsrsDueWordIds, recallFromRow } from "../fsrs-store";
import { LEECH_LAPSE_THRESHOLD } from "../fsrs-scheduler";
import { dailyNewQuota, getReviewQueue, lastAnsweredWord, recentAnswersToday } from "./session-state";
import {
  directionTaskCount,
  ensureDirectionCards,
  ensureDirectionColumns,
  type StudyDirection
} from "./directions";

/**
 * 「当日计划」和「出哪张」——**三个方向共用这一份**。
 *
 * 以前只有正向走这套(FSRS 到期集 → 优先级 → 排片),反向和汉字各有一套 temp_score
 * 土办法:出题按分数升序、过关看 temp_score ≥ 10、没有每日上限、不记复习流水、
 * 关掉应用状态就没了。所以「哪个模式特别」不是错觉,是两套代码。
 *
 * 现在方向只是参数:换的是「记忆表 + 当日任务表 + 哪些词有这个方向的卡」,
 * 规则一个字都不改。正向额外的那些东西(moji 滴灌激活、续杯加餐、计划版本重置)
 * 留在 stage1.ts —— 它们和「方向」无关,是词库导入和当日加餐的事。
 */

/** 排片器要的「预测答对概率」;没有调度记录的按中性偏易处理 */
const predictedRecall = (row: Record<string, unknown>): number =>
  recallFromRow(row) ?? UNKNOWN_RECALL;

/** 当日任务表里这个方向今天已经排了多少张 */
const newTaskCount = (direction: StudyDirection, day: string) => firstValue<number>(
  `SELECT COUNT(*)
   FROM ${direction.taskTable} t
   JOIN ${direction.entity.table} m ON m.word_id = t.word_id
   WHERE t.reviewed_on = ? AND COALESCE(m.seen_count, 0) = 0`,
  [day],
  0
);

/**
 * 生成这个方向的当日计划:到期集(受各自的复习上限约束)+ 新卡配额。
 *
 * 「各自一份上限」:三个方向各按同一个复习上限设置排自己的当日计划,互不挤占。
 */
export const createDirectionTasks = (
  direction: StudyDirection,
  day = today(),
  // 只有「用户真的进了这个模式」才引入新卡。首页读一次统计就播种的话,
  // 从没练过反向的人也会天天攒下反向的新卡,攒成一座永远还不完的债。
  introduceNew = false
) => {
  ensureDirectionColumns(direction);
  const db = getDatabase();
  if (directionTaskCount(direction, day) > 0) return;

  // 今天已经答过的先回填进任务表,否则刷新页面后当日进度会归零
  backfillDirectionTasksFromToday(direction, day);

  const cap = dailyReviewCap(getReviewCapPreference(), day);
  const reviewLimit = Math.max(cap - directionTaskCount(direction, day), 0);
  let orderIndex = directionTaskCount(direction, day) + 1;

  fsrsDueWordIds(reviewLimit, studyDayEnd(), direction.entity).forEach((wordId) => {
    db.run(`
      INSERT OR IGNORE INTO ${direction.taskTable} (reviewed_on, word_id, order_index)
      VALUES (?, ?, ?)
    `, [day, wordId, orderIndex]);
    orderIndex += 1;
  });

  // 新卡:按需建卡(从正向状态播种),建出来的当天就参与
  const newQuota = introduceNew ? Math.max(dailyNewQuota() - newTaskCount(direction, day), 0) : 0;
  if (newQuota > 0) {
    ensureDirectionCards(direction, newQuota);
    fsrsDueWordIds(newQuota, studyDayEnd(), direction.entity).forEach((wordId) => {
      db.run(`
        INSERT OR IGNORE INTO ${direction.taskTable} (reviewed_on, word_id, order_index)
        VALUES (?, ?, ?)
      `, [day, wordId, orderIndex]);
      orderIndex += 1;
    });
  }
};

/** 今天答过但不在任务表里的,补回来(刷新/换设备后接得上) */
const backfillDirectionTasksFromToday = (direction: StudyDirection, day: string) => {
  const rows = rowsFor(`
    SELECT word_id, MIN(id) AS first_review_id
    FROM reviews
    WHERE reviewed_on = ? AND direction = ? AND answer != 'known_forever'
    GROUP BY word_id
    ORDER BY first_review_id ASC
  `, [day, direction.id]);
  rows.forEach((row, index) => {
    getDatabase().run(`
      INSERT OR IGNORE INTO ${direction.taskTable} (reviewed_on, word_id, order_index)
      VALUES (?, ?, ?)
    `, [day, Number(row.word_id), index + 1]);
  });
};

export const ensureDirectionTasks = (direction: StudyDirection, introduceNew = false) => {
  createDirectionTasks(direction, today(), introduceNew);
};

/**
 * 当日进度。完成的判据和正向完全一样:**今天毕业**(下次到期越过本学习日),
 * 或者这个词被手动标了永久熟知。不再有 temp_score ≥ 10 那一套。
 */
export const directionProgressCounts = (direction: StudyDirection) => {
  const day = today();
  ensureDirectionTasks(direction);
  const total = directionTaskCount(direction, day);
  const completed = firstValue<number>(`
    SELECT COUNT(DISTINCT t.word_id)
    FROM ${direction.taskTable} t
    JOIN ${direction.entity.table} m ON m.word_id = t.word_id
    LEFT JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND (
        COALESCE(p.known_forever, 0) = 1
        OR (m.fsrs_due IS NOT NULL AND m.fsrs_due > ?)
      )
  `, [day, studyDayEnd().toISOString()], 0);
  return { total, completed: Math.min(completed, total) };
};

/** 这个方向的卡长什么样:计数和 FSRS 全取自它自己那张记忆表,只有「永久熟知」看 progress */
const directionCardColumns = (direction: StudyDirection) => `
      w.*,
      m.word_id,
      m.seen_count,
      m.right_count,
      m.fuzzy_count,
      m.forgot_count,
      m.mistake_streak,
      m.last_seen_on,
      m.fsrs_stability,
      m.fsrs_difficulty,
      m.fsrs_due,
      m.fsrs_last_review,
      m.fsrs_state,
      m.fsrs_reps,
      m.fsrs_lapses,
      COALESCE(p.known_forever, 0) AS known_forever,
      COALESCE(n.note, '') AS note
    FROM ${direction.entity.table} m
    JOIN words w ON w.id = m.word_id
    LEFT JOIN progress p ON p.word_id = m.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id`;

/**
 * 按 id 取这个方向的一张卡(撤销要把刚答的那张原样交回来)。
 * 不能拿正向的 progress 拼:那样反向卡上显示的复习次数是正向的。
 */
export const directionCardById = (direction: StudyDirection, wordId: number): WordCard | null => {
  ensureDirectionColumns(direction);
  const row = firstRow(`SELECT ${directionCardColumns(direction)} WHERE m.word_id = ?`, [wordId]);
  return row ? rowObjectToCard(row) : null;
};

/**
 * 出下一张。和正向同一条流水线:
 * 到期集 → 优先级打分 → 「隔几张再出」硬闸门 → 排片(干扰隔离/开场减压/连败保护/加权随机)。
 */
export const pickDirectionNext = (
  direction: StudyDirection,
  excludedIds: Set<number> = new Set()
): WordCard | null => {
  const day = today();
  ensureDirectionTasks(direction);
  const queueById = new Map(getReviewQueue(direction.id).map((item) => [item.word_id, item.due_after]));

  const rows = rowsFor(`
    SELECT
      w.*,
      m.word_id,
      m.seen_count,
      m.right_count,
      m.fuzzy_count,
      m.forgot_count,
      m.mistake_streak,
      m.last_seen_on,
      m.fsrs_stability,
      m.fsrs_difficulty,
      m.fsrs_due,
      m.fsrs_last_review,
      m.fsrs_state,
      m.fsrs_reps,
      m.fsrs_lapses,
      COALESCE(p.known_forever, 0) AS known_forever,
      t.order_index,
      'review' AS task_type,
      COALESCE(n.note, '') AS note
    FROM ${direction.taskTable} t
    JOIN words w ON w.id = t.word_id
    JOIN ${direction.entity.table} m ON m.word_id = t.word_id
    LEFT JOIN progress p ON p.word_id = t.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ?
      AND COALESCE(p.known_forever, 0) = 0
      -- 「本学习日内仍到期」的都要出:没答的、答错还在重学步骤里的
      AND (m.fsrs_due IS NULL OR m.fsrs_due <= ?)
  `, [day, studyDayEnd().toISOString()]);

  const availableRows = rows.filter((row) => !excludedIds.has(Number(row.id)));
  if (!availableRows.length) return null;

  const lastId = lastAnsweredWord(direction.id);
  const lastRow = availableRows.find((row) => Number(row.id) === lastId);
  const repeatAllowed = allowsBackToBack({
    mistakeStreak: Number(lastRow?.mistake_streak ?? 0),
    remaining: availableRows.length,
    total: directionTaskCount(direction, day)
  });
  // 顽固卡连着错到阈值 → 当场接着刷(排片会把刚答错的当难卡避开,正好废掉这个机制)
  const stubbornDrill = lastRow
    && Number(lastRow.mistake_streak ?? 0) >= STUBBORN_MISTAKE_STREAK
    && (queueById.get(lastId) ?? 0) <= 0;
  if (stubbornDrill) return rowObjectToCard(lastRow);

  const pickable = availableRows.length > 1 && !repeatAllowed
    ? availableRows.filter((row) => Number(row.id) !== lastId)
    : availableRows;

  const candidates = pickable.map((row) => ({
    score: priorityScore(priorityComponents(row, queueById.get(Number(row.id)), 0)),
    dueAfter: queueById.get(Number(row.id)) ?? 0,
    row
  }));
  if (!candidates.length) return null;

  const ready = candidates.filter((item) => item.dueAfter <= 0);
  if (!ready.length) {
    candidates.sort((left, right) => left.dueAfter - right.dueAfter || right.score - left.score);
    return rowObjectToCard(candidates[0].row);
  }

  const recent = recentAnswersToday(day, INTERFERENCE_WINDOW, direction.id);
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
      interference: sessionInterference(day, rows, direction.id)
    }
  );
  if (!picked) return null;
  const pickedRow = ready.find((item) => Number(item.row.id) === picked.id)?.row;
  return rowObjectToCard(pickedRow ?? ready[0].row);
};
