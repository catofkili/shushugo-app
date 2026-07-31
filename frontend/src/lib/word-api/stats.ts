import { getDatabase } from "../database";
import type { WordStats } from "../../types/vocabulary";
import { getDailyWordGoal } from "../studyPreferences";
import { daysSince, firstValue, rowsFor, today } from "../study-core";
import type { WordSessionOptions } from "../study-types";
import {
  currentComeback,
  encoreChunkSize,
  estimatedMinutesFor,
  fatigueDetected,
  readEncoreLog,
  recentReviewAverages
} from "../comeback";
import { ensureProgressInitialized } from "./bootstrap";
import { dailyNewQuota } from "./session-state";
import { encoreRemainingCount, stage1ProgressCounts } from "./stage1";
import { kanjiStats, stage2Stats } from "./queues";
import { wordFilterSql } from "./filters";

/**
 * 统计口径:今日学习量 + 首页/学习页要读的那一大坨 WordStats。
 * 这里只读不写(除了回归模式的自动调档),所有判定条件都跟着 FSRS 开关走。
 *
 * 从 word-api.ts 原样搬出,逻辑一字未改。
 */

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

