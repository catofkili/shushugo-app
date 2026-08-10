import { getDatabase } from "../database";
import type { WordStats } from "../../types/vocabulary";
import { getDailyWordGoal } from "../studyPreferences";
import { firstValue, rowsFor, studyDayEnd, today } from "../study-core";
import type { WordSessionOptions } from "../study-types";
import {
  encoreChunkSize,
  estimatedMinutesFor,
  fatigueDetected,
  readEncoreLog,
  recentReviewAverages
} from "../review-budget";
import { ensureProgressInitialized } from "./bootstrap";
import { dailyNewQuota } from "./session-state";
import { encoreRemainingCount, stage1ProgressCounts } from "./stage1";
import { directionProgressCounts } from "./direction-plan";
import { KANJI, REVERSE } from "./directions";
import { mistakeCandidateSql, wordFilterSql } from "./filters";

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
  const total = firstValue<number>(`
    SELECT COUNT(*)
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE 1 = 1 ${filter.clause}
  `, filter.params, 0);
  const knownForever = firstValue<number>(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 1 ${filter.clause}
  `, filter.params, 0);
  const reviewedToday = firstValue<number>("SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ?", [studyDate], 0);
  // 「薄弱」= FSRS 认为本学习日内该复习的。以前用 score <= 6,和真正排给你背的
  // FSRS 到期集是两套口径(实测能差 300 多个),首页显示的数和实际任务量对不上。
  const lowCount = firstValue<number>(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND p.seen_count > 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) ${filter.clause}
  `, [studyDayEnd().toISOString(), ...filter.params], 0);
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
  // 错题本有自己的一套数:池子是「长期薄弱词」,进度是「今天攻掉几个」。
  // 它不碰今日计划,所以顶上的 stage1 进度在这个模式里是死的 —— 必须给它自己的数字,
  // 否则界面显示的还是「今日复习 1/985」,答一天也不动(这正是错题本粘住首页时的表象)。
  const mistakes = {
    poolSize: firstValue<number>(`
      SELECT COUNT(*)
      FROM progress p
      WHERE p.known_forever = 0 AND ${mistakeCandidateSql("p")}
    `, [], 0),
    answeredToday: firstValue<number>(`
      SELECT COUNT(DISTINCT r.word_id)
      FROM reviews r
      JOIN progress p ON p.word_id = r.word_id
      WHERE r.reviewed_on = ? AND ${mistakeCandidateSql("p")}
    `, [studyDate], 0)
  };
  const stage1Progress = stage1ProgressCounts();
  // 反向/汉字的当日进度和正向同一个判据(今天毕业才算完成),见 direction-plan
  const stage2 = directionProgressCounts(REVERSE);
  const kanji = directionProgressCounts(KANJI);
  // 模式切换器要显示「每个模式现在能练多少」。三个方向各有自己的当日计划,
  // directionProgressCounts 会顺手把当天的计划排好,所以这里读到的就是真实剩余量。
  const planRemaining = Math.max(stage1Progress.total - stage1Progress.completed, 0);
  const modeCounts = {
    classic: planRemaining,
    mistakes: mistakes.poolSize,
    // 快速复习翻的还是今日计划那批词,只是换了个一页 50 张的形态
    quick: planRemaining,
    // 三个方向都各有自己的当日计划,直接读各自的剩余量
    reverse: Math.max(stage2.total - stage2.completed, 0),
    kanji: Math.max(kanji.total - kanji.completed, 0)
  };
  const checkinRows = getDatabase().exec("SELECT checked_on FROM checkins ORDER BY checked_on");
  const checkins = checkinRows.length ? checkinRows[0].values.map((row) => String(row[0])) : [];
  const wordStudySecondsToday = firstValue<number>(
    "SELECT seconds FROM word_study_time WHERE studied_on = ?",
    [studyDate],
    0
  );

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
  return {
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
    mistakes,
    modeCounts,
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
