import type { WordStats } from "../../types/vocabulary";
import { getDailyWordGoal, getJlptPlanPreferences } from "../studyPreferences";
import { grammarPlanDone, grammarPlanRemaining } from "../grammar-quiz";
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
import { pickedProgress } from "./picked";
import { mistakeCandidateSql, wordFilterSql } from "./filters";
import { ensureDailyRelief, getDailyReliefProgress } from "./daily-relief";
import { ensureDailyTail, getDailyTailProgress } from "./daily-tail";
import { MASTERED_SQL } from "../fsrs-store";
import { isKanjiUnitSchedulerEnabled, kanjiUnitProgress } from "../kanji-unit-scheduler";
import { kanjiUnitIndexLoaded } from "../kanji-unit-index";

export interface WordStatsOptions {
  /** Read the isolated local kanji-unit queue instead of creating legacy word tasks. */
  kanjiUnits?: boolean;
}

/**
 * 统计口径:今日学习量 + 首页/学习页要读的那一大坨 WordStats。
 * 所有判定条件都跟着 FSRS 开关走。
 *
 * 口径从 word-api.ts 原样搬出、一字未改;2026-09-06 只改了**什么时候算**
 * (见下面 lazy 上那段),没有改任何一个数的算法。
 */

const dailyStudyStats = (day = today()) => {
  const days = new Map<string, { date: string; seconds: number; wordCount: number }>();
  rowsFor(`
    SELECT studied_on, seconds
    FROM word_study_time
    WHERE studied_on BETWEEN date(?, '-30 day') AND ?
  `, [day, day]).forEach((row) => {
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
    WHERE direction = 'forward'
      AND reviewed_on BETWEEN date(?, '-30 day') AND ?
    GROUP BY reviewed_on
  `, [day, day]).forEach((row) => {
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

/**
 * 一次会话内只算一次的惰性字段。
 *
 * ⚠️ 这是这张表能便宜下来的**唯一**原因,别改回「先全算好再返回」。
 * 实测:每答一次卡,getWordStats 被算 **2 遍**(会话一遍 + 顶栏 SquirrelTrail 的
 * PROGRESS_UPDATED 监听一遍),而学习页真正读的只有 stage1Progress / dailyRelief /
 * stage1Done / dailyPlanDone 这几项。剩下的 30 天曲线、打卡表、全库 COUNT、
 * 反向和汉字的当日计划,统统是首页才看的,却在每次评分的同步栈里算了两遍。
 *
 * 惰性化之后这些字段只在**真被读到**时才算,而且算完就记住 —— 所以首页拿到的
 * 仍然是同一时刻的一致快照,不会出现「这个数是答题前的、那个数是答题后的」。
 */
const lazy = <T>(compute: () => T): (() => T) => {
  let box: { value: T } | null = null;
  return () => (box ??= { value: compute() }).value;
};

export function getWordStats(
  phase = "stage1",
  options: WordSessionOptions = {},
  statsOptions: WordStatsOptions = {}
): WordStats {
  ensureProgressInitialized();
  const studyDate = today();
  const filter = wordFilterSql(options, "w");

  // ---- 便宜且学习页每张卡都要读的:照旧立即算 ----
  // 减负和压轴都带写(当天没排过就在这里排),不能挪进 getter —— 它们是
  // 「今天该给你什么」的一部分,不是展示用的统计。
  ensureDailyRelief();
  const dailyReliefProgress = getDailyReliefProgress();
  const stage1Progress = stage1ProgressCounts();
  // 压轴在后台单独保存,但前端进度流要把它当成普通的后续词。
  ensureDailyTail();
  const dailyTailProgress = getDailyTailProgress();
  const frontProgress = {
    // 顶部计数板数的是用户今天实际看过的完整正向流。减负卡虽然不写 reviews/FSRS，
    // 但每张都真实发到学习页并被收走，必须和正式计划、压轴一样进入分子和分母；
    // 否则开场连续清掉几张，松鼠和计数会一直不动。
    completed: dailyReliefProgress.completed + stage1Progress.completed + dailyTailProgress.completed,
    total: dailyReliefProgress.total + stage1Progress.total + dailyTailProgress.total
  };
  const actualStage1Done = stage1Progress.total > 0 && stage1Progress.completed >= stage1Progress.total;
  const dailyPlanDone = actualStage1Done
    && dailyReliefProgress.pending === 0
    && dailyTailProgress.pending === 0;
  const planRemaining = Math.max(frontProgress.total - frontProgress.completed, 0);

  // ---- 首页/统计才读的:读到才算 ----
  const total = lazy(() => firstValue<number>(`
    SELECT COUNT(*)
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE 1 = 1 ${filter.clause}
  `, filter.params, 0));
  const knownForever = lazy(() => firstValue<number>(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 1 ${filter.clause}
  `, filter.params, 0));
  const reviewedToday = lazy(() => firstValue<number>(
    "SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ? AND direction = 'forward'",
    [studyDate],
    0
  ));
  // 「薄弱」= FSRS 认为本学习日内该复习的。以前用 score <= 6,和真正排给你背的
  // FSRS 到期集是两套口径(实测能差 300 多个),首页显示的数和实际任务量对不上。
  const lowCount = lazy(() => firstValue<number>(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND p.seen_count > 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) ${filter.clause}
  `, [studyDayEnd().toISOString(), ...filter.params], 0));
  const unseenCount = lazy(() => firstValue<number>(
    `
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND p.seen_count = 0 ${filter.clause}
    `,
    filter.params,
    0
  ));
  // 错题本有自己的一套数:池子是「长期薄弱词」,进度是「今天攻掉几个」。
  // 它不碰今日计划,所以顶上的 stage1 进度在这个模式里是死的 —— 必须给它自己的数字,
  // 否则界面显示的还是「今日复习 1/985」,答一天也不动(这正是错题本粘住首页时的表象)。
  const mistakes = lazy(() => ({
    poolSize: firstValue<number>(`
      SELECT COUNT(*)
      FROM progress p
      WHERE p.known_forever = 0 AND ${mistakeCandidateSql("p")}
    `, [], 0),
    answeredToday: firstValue<number>(`
      SELECT COUNT(DISTINCT r.word_id)
      FROM reviews r
      JOIN progress p ON p.word_id = r.word_id
      WHERE r.reviewed_on = ? AND r.direction = 'forward' AND ${mistakeCandidateSql("p")}
    `, [studyDate], 0)
  }));
  // 反向/汉字的当日进度和正向同一个判据(今天毕业才算完成),见 direction-plan。
  // ⚠️ directionProgressCounts 会顺手把那个方向的当日计划排好 —— 惰性化之后,
  // 反向/汉字的计划改成「首页读到角标时才排」,而不是每次评分都排一遍。
  const stage2 = lazy(() => directionProgressCounts(REVERSE));
  // 走单位队列还是旧的词级队列,默认由功能开关决定 —— 以前要调用方显式传
  // statsOptions.kanjiUnits,而**没有任何调用方传过**,于是首页永远读旧路径,
  // 显示的是「今天到期几张」而不是「今天能练多少」。牌堆小的时候那个数就是 0。
  const kanji = lazy(() => {
    const useKanjiUnits = statsOptions.kanjiUnits ?? (isKanjiUnitSchedulerEnabled() && kanjiUnitIndexLoaded());
    return useKanjiUnits ? kanjiUnitProgress() : directionProgressCounts(KANJI);
  });
  // 混合模式今天还欠几条语法(备考目标那一级)。语法是**加在**今日计划之上的活,
  // 不摊进词数里 —— 摊进去的话混合和经典写着同一个数,多出来的那部分在主页上就不存在。
  const grammarRemaining = lazy(() => grammarPlanRemaining(getJlptPlanPreferences().target));
  // 今天已经过关的语法条数。混合模式的松鼠小路要拿它当分子 —— 小路画的是「这一场」，
  // 而混合模式的一场里语法和单词是同一场（角标、大卡都已经按合计算）。
  const grammarDone = lazy(() => grammarPlanDone(getJlptPlanPreferences().target));
  const modeCounts = lazy(() => ({
    classic: planRemaining,
    // 混合 = 同一份今日计划 + 插播的语法,所以角标是两者的合计(主页拆成两栏说明)。
    mixed: planRemaining + grammarRemaining(),
    mistakes: mistakes().poolSize,
    // 快速复习翻的还是今日计划那批词,只是换了个一页 50 张的形态
    quick: planRemaining,
    // 三个方向都各有自己的当日计划,直接读各自的剩余量
    reverse: Math.max(stage2().total - stage2().completed, 0),
    kanji: Math.max(kanji().total - kanji().completed, 0),
    // 自选清单不是个常驻词池，没勾过就是 0
    picked: pickedProgress().remaining
  }));
  const checkins = lazy(() => rowsFor("SELECT checked_on FROM checkins ORDER BY checked_on")
    .map((row) => String(row.checked_on ?? "")));
  const wordStudySecondsToday = lazy(() => firstValue<number>(
    "SELECT seconds FROM word_study_time WHERE studied_on = ?",
    [studyDate],
    0
  ));
  const encore = lazy(() => {
    const remainingBacklog = encoreRemainingCount(studyDate);
    const { secondsPerWord: recentSecondsPerWord } = recentReviewAverages(studyDate);
    // 估算耗时优先用今天的实际节奏（含反向/汉字阶段的开销），没有数据再退回近期均值
    const secondsPerWord = reviewedToday() > 0 && wordStudySecondsToday() > 0
      ? Math.min(Math.max(wordStudySecondsToday() / reviewedToday(), 6), 60)
      : recentSecondsPerWord;
    // 优先清积压(递减批);积压见底后用新词续杯 = 强度的一半(最少 5),
    // 白天已学一份强度,加餐给半份,防一天吞两倍新词把明天复习堆爆。
    const backlogChunk = encoreChunkSize(remainingBacklog);
    const newWordChunk = Math.max(Math.round(getDailyWordGoal() / 2), 5);
    const encoreSize = backlogChunk > 0 ? backlogChunk : Math.min(newWordChunk, unseenCount());
    const encoreLog = readEncoreLog(studyDate);
    return {
      available: encoreSize > 0,
      size: encoreSize,
      estimatedMinutes: estimatedMinutesFor(encoreSize, secondsPerWord),
      remaining: remainingBacklog,
      unseenRemaining: unseenCount(),
      secondsPerWord,
      totalLearned: firstValue<number>(
        "SELECT COUNT(*) FROM progress WHERE seen_count > 0 OR known_forever = 1", [], 0
      ),
      weekEncoreCount: encoreLog.weekCount,
      todayEncoreWords: encoreLog.dayWords,
      fatigued: fatigueDetected(studyDate)
    };
  });
  const newTodayCount = lazy(() => firstValue<number>(
    `
    SELECT COUNT(DISTINCT today_reviews.word_id)
    FROM reviews today_reviews
    WHERE today_reviews.reviewed_on = ?
      AND today_reviews.direction = 'forward'
      AND NOT EXISTS (
        SELECT 1
        FROM reviews earlier_reviews
        WHERE earlier_reviews.word_id = today_reviews.word_id
          AND earlier_reviews.direction = 'forward'
          AND earlier_reviews.reviewed_on < ?
      )
    `,
    [studyDate, studyDate],
    0
  ));

  return {
    get encore() { return encore(); },
    dailyRelief: dailyReliefProgress,
    get total() { return total(); },
    get knownForever() { return knownForever(); },
    get masteredToday() {
      return firstValue<number>(
        `SELECT COUNT(DISTINCT r.word_id)
         FROM reviews r
         JOIN progress p ON p.word_id = r.word_id
         WHERE r.reviewed_on = ?
           AND r.direction = 'forward'
           AND (p.known_forever = 1 OR ${MASTERED_SQL})`,
        [studyDate],
        0
      );
    },
    get reviewedToday() { return reviewedToday(); },
    get lowCount() { return lowCount(); },
    get unseenCount() { return unseenCount(); },
    get newToday() { return newTodayCount(); },
    get oldToday() { return Math.max(0, reviewedToday() - newTodayCount()); },
    get newQuota() { return dailyNewQuota(); },
    get mistakes() { return mistakes(); },
    get modeCounts() { return modeCounts(); },
    get grammarRemaining() { return grammarRemaining(); },
    get grammarDone() { return grammarDone(); },
    stage1ProgressDone: frontProgress.completed,
    stage1ProgressTotal: frontProgress.total,
    stage1NewDone: stage1Progress.newLane.done,
    stage1NewTotal: stage1Progress.newLane.total,
    // 减负卡和压轴对用户来说就是复习,并进这一栏 —— 否则「新词 + 复习」
    // 加起来对不上大卡上那个合计数,两个数字打架比不显示还糟。
    stage1ReviewDone: stage1Progress.reviewLane.done + dailyReliefProgress.completed + dailyTailProgress.completed,
    stage1ReviewTotal: stage1Progress.reviewLane.total + dailyReliefProgress.total + dailyTailProgress.total,
    phase,
    stage1Done: actualStage1Done,
    dailyPlanDone,
    get stage2Total() { return stage2().total; },
    get stage2Completed() { return stage2().completed; },
    get kanjiTotal() { return kanji().total; },
    get kanjiCompleted() { return kanji().completed; },
    studyDate,
    get checkins() { return checkins(); },
    get dailyStudyStats() { return dailyStudyStats(studyDate); },
    get wordStudySecondsToday() { return wordStudySecondsToday(); },
    get taskDone() {
      return kanji().total > 0
        ? kanji().completed >= kanji().total
        : stage2().total > 0
          ? stage2().completed >= stage2().total
          : dailyPlanDone;
    }
  };
}
