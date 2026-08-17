/**
 * 学习分析数据模块
 */

import { firstRow, firstValue, rowsFor, studyDate } from "../database/db-utils";
import { updateMemoryProfileIfNeeded, getUserMemoryProfile, getMemoryStrengthLabel } from "../adaptive";
import { ensureFsrsColumns, MASTERED_SQL } from "../fsrs-store";

export interface DailyStudyTime {
  date: string;
  minutes: number;
  wordCount: number;
}

export interface TimeOfDayStats {
  hour: number;
  avgCorrectRate: number;
  studyCount: number;
}

export interface StudyTimeAnalytics {
  dailyMinutes: DailyStudyTime[];
  bestTimeOfDay: TimeOfDayStats[];
  totalHours: number;
  streakDays: number;
  avgDailyMinutes: number;
}

export interface LevelMastery {
  level: string;
  total: number;
  /** 有真实正向学习记录的词数,不是 progress 行数。 */
  studied: number;
  mastered: number;
  learning: number;
  struggling: number;
  percentage: number;
}

export interface PosMastery {
  pos: string;
  avgStability: number;
  count: number;
  masteredCount: number;
}

export interface MasteryAnalytics {
  byLevel: LevelMastery[];
  byPartOfSpeech: PosMastery[];
  estimatedDaysToComplete: Record<string, number>;
}

export interface DifficultWord {
  id: number;
  kanji: string;
  kana: string;
  meaning: string;
  errorRate: number;
  totalReviews: number;
  stability: number;
}

export interface ErrorAnalytics {
  mostDifficultWords: DifficultWord[];
  errorTypeDistribution: {
    forgot: number;
    fuzzy: number;
    know: number;
  };
}

export interface EfficiencyAnalytics {
  avgReviewsToMaster: number;
  newWordsPerHour: number;
  retentionRate7Days: number;
  retentionSampleSize: number;
  efficiencyTrend: 'improving' | 'stable' | 'declining';
  memoryStrength: number;
  memoryStrengthLabel: string;
  memorySampleSize: number;
}

export interface StudyAnalytics {
  studyTime: StudyTimeAnalytics;
  mastery: MasteryAnalytics;
  errors: ErrorAnalytics;
  efficiency: EfficiencyAnalytics;
  generatedAt: string;
}

/**
 * 获取学习时长分析
 */
export function getStudyTimeAnalytics(): StudyTimeAnalytics {
  const day = studyDate();
  // 最近30天的学习时长
  const dailyMinutes = rowsFor(`
    SELECT
      studied_on AS date,
      CAST(seconds / 60.0 AS INTEGER) AS minutes,
      0 AS wordCount
    FROM word_study_time
    WHERE studied_on BETWEEN date(?, '-30 days') AND ?
    ORDER BY studied_on DESC
  `, [day, day]).map(row => ({
    date: String(row.date),
    minutes: Number(row.minutes ?? 0),
    wordCount: 0 // 暂时不统计，可以后续添加
  }));

  // 总学习时长（小时）
  const totalSeconds = firstValue<number>(
    "SELECT SUM(seconds) FROM word_study_time",
    [],
    0
  );
  const totalHours = Math.floor(totalSeconds / 3600);

  // 连续打卡天数
  const checkins = rowsFor(`
    SELECT checked_on FROM checkins ORDER BY checked_on DESC
  `).map(row => String(row.checked_on));

  let streakDays = 0;
  const today = studyDate();
  for (let i = 0; i < checkins.length; i++) {
    const expectedDate = new Date(today);
    expectedDate.setDate(expectedDate.getDate() - i);
    const expected = expectedDate.toISOString().slice(0, 10);
    if (checkins[i] === expected) {
      streakDays++;
    } else {
      break;
    }
  }

  // 平均每日学习时长
  const avgDailyMinutes = dailyMinutes.length > 0
    ? Math.round(dailyMinutes.reduce((sum, d) => sum + d.minutes, 0) / dailyMinutes.length)
    : 0;

  // 最佳学习时段（暂时返回空数组，需要记录学习时间戳才能计算）
  const bestTimeOfDay: TimeOfDayStats[] = [];

  return {
    dailyMinutes,
    bestTimeOfDay,
    totalHours,
    streakDays,
    avgDailyMinutes
  };
}

/**
 * 获取掌握度分析
 */
export function getMasteryAnalytics(): MasteryAnalytics {
  // 按 JLPT 等级统计。total 是词表规模,studied 才是有真实学习记录的词数。
  // progress 会在启动时为全库补行,所以不能再用 JOIN progress 作为「已学习」判据。
  const byLevel = rowsFor(`
    SELECT
      COALESCE(w.jlpt_level, '未分级') AS level,
      COUNT(*) AS total,
      SUM(CASE WHEN p.seen_count > 0 OR p.known_forever = 1 OR EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.word_id = w.id AND r.direction = 'forward'
      ) THEN 1 ELSE 0 END) AS studied,
      SUM(CASE WHEN (p.seen_count > 0 OR p.known_forever = 1 OR EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.word_id = w.id AND r.direction = 'forward'
      )) AND (p.known_forever = 1 OR ${MASTERED_SQL}) THEN 1 ELSE 0 END) AS mastered,
      SUM(CASE WHEN (p.seen_count > 0 OR p.known_forever = 1 OR EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.word_id = w.id AND r.direction = 'forward'
      )) AND NOT (p.known_forever = 1 OR ${MASTERED_SQL})
        AND COALESCE(p.fsrs_lapses, 0) = 0 THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN (p.seen_count > 0 OR p.known_forever = 1 OR EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.word_id = w.id AND r.direction = 'forward'
      )) AND NOT (p.known_forever = 1 OR ${MASTERED_SQL})
        AND COALESCE(p.fsrs_lapses, 0) > 0 THEN 1 ELSE 0 END) AS struggling
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE w.jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')
    GROUP BY w.jlpt_level
    ORDER BY CASE w.jlpt_level
      WHEN 'N5' THEN 1
      WHEN 'N4' THEN 2
      WHEN 'N3' THEN 3
      WHEN 'N2' THEN 4
      WHEN 'N1' THEN 5
      ELSE 9 END
  `).map(row => {
    const total = Number(row.total ?? 0);
    const studied = Number(row.studied ?? 0);
    const mastered = Number(row.mastered ?? 0);
    return {
      level: String(row.level),
      total,
      studied,
      mastered,
      learning: Number(row.learning ?? 0),
      struggling: Number(row.struggling ?? 0),
      percentage: studied > 0 ? Math.round((mastered / studied) * 100) : 0
    };
  });

  // 按词性统计,只看真实学过的词;稳定度是 FSRS 的长期记忆指标。
  const byPartOfSpeech = rowsFor(`
    SELECT
      CASE
        WHEN pos LIKE '%名%' THEN '名词'
        WHEN pos LIKE '%動%' OR pos LIKE '%动%' THEN '动词'
        WHEN pos LIKE '%形%' THEN '形容词'
        WHEN pos LIKE '%副%' THEN '副词'
        ELSE '其他'
      END AS pos,
      AVG(p.fsrs_stability) AS avgStability,
      COUNT(*) AS count,
      SUM(CASE WHEN p.known_forever = 1 OR ${MASTERED_SQL} THEN 1 ELSE 0 END) AS masteredCount
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE (p.seen_count > 0 OR p.known_forever = 1 OR EXISTS (
      SELECT 1 FROM reviews r
      WHERE r.word_id = w.id AND r.direction = 'forward'
    ))
    GROUP BY pos
    ORDER BY count DESC
    LIMIT 5
  `).map(row => ({
    pos: String(row.pos),
    avgStability: Math.round(Number(row.avgStability ?? 0) * 10) / 10,
    count: Number(row.count ?? 0),
    masteredCount: Number(row.masteredCount ?? 0)
  }));

  // 预计完成天数（简单计算）
  const estimatedDaysToComplete: Record<string, number> = {};
  const avgNewWordsPerDay = firstValue<number>(
    `SELECT AVG(daily_new) FROM (
      SELECT COUNT(DISTINCT word_id) AS daily_new
      FROM reviews
      WHERE direction = 'forward'
        AND reviewed_on BETWEEN date(?, '-7 days') AND ?
      GROUP BY reviewed_on
    )`,
    [studyDate(), studyDate()],
    10
  );

  byLevel.forEach(level => {
    const remaining = level.total - level.mastered;
    const days = avgNewWordsPerDay > 0 ? Math.ceil(remaining / avgNewWordsPerDay) : 999;
    estimatedDaysToComplete[level.level] = days;
  });

  return {
    byLevel,
    byPartOfSpeech,
    estimatedDaysToComplete
  };
}

/**
 * 获取错误分析
 */
export function getErrorAnalytics(): ErrorAnalytics {
  // 最困难的20个单词
  const mostDifficultWords = rowsFor(`
    SELECT
      w.id,
      w.kanji,
      w.kana,
      w.meaning,
      p.fsrs_stability,
      COUNT(r.id) AS totalReviews,
      SUM(CASE WHEN r.answer IN ('forgot', 'fuzzy') THEN 1 ELSE 0 END) AS wrong_count
    FROM words w
    JOIN progress p ON p.word_id = w.id
    JOIN reviews r ON r.word_id = w.id AND r.direction = 'forward'
    WHERE p.known_forever = 0
    GROUP BY w.id, w.kanji, w.kana, w.meaning, p.fsrs_stability
    HAVING COUNT(r.id) >= 3
    ORDER BY
      SUM(CASE WHEN r.answer = 'forgot' THEN 2.0 WHEN r.answer = 'fuzzy' THEN 1.0 ELSE 0 END)
        / NULLIF(COUNT(r.id), 0) DESC,
      COALESCE(p.fsrs_stability, 0) ASC
    LIMIT 20
  `).map(row => {
    const wrongCount = Number(row.wrong_count ?? 0);
    const totalReviews = Number(row.totalReviews ?? 1);
    return {
      id: Number(row.id),
      kanji: String(row.kanji),
      kana: String(row.kana),
      meaning: String(row.meaning),
      errorRate: Math.round((wrongCount / totalReviews) * 100),
      totalReviews,
      stability: Number(row.fsrs_stability ?? 0)
    };
  });

  // 错误类型分布使用真实正向答题流水,不再依赖可能被历史导入污染的聚合列。
  const errorDist = firstRow(`
    SELECT
      SUM(CASE WHEN answer = 'forgot' THEN 1 ELSE 0 END) AS forgot,
      SUM(CASE WHEN answer = 'fuzzy' THEN 1 ELSE 0 END) AS fuzzy,
      SUM(CASE WHEN answer IN ('know', 'known_forever') THEN 1 ELSE 0 END) AS know
    FROM reviews
    WHERE direction = 'forward'
  `);

  const errorTypeDistribution = {
    forgot: Number(errorDist?.forgot ?? 0),
    fuzzy: Number(errorDist?.fuzzy ?? 0),
    know: Number(errorDist?.know ?? 0)
  };

  return {
    mostDifficultWords,
    errorTypeDistribution
  };
}

/**
 * 获取学习效率分析
 */
export function getEfficiencyAnalytics(): EfficiencyAnalytics {
  // 平均需要复习几次才能掌握。掌握判据只认 FSRS 间隔/手动熟知,次数来自真实正向流水。
  const avgReviewsToMaster = firstValue<number | null>(
    `SELECT AVG(review_count) FROM (
      SELECT p.word_id, COUNT(r.id) AS review_count
      FROM progress p
      JOIN reviews r ON r.word_id = p.word_id AND r.direction = 'forward'
      WHERE p.known_forever = 1 OR ${MASTERED_SQL}
      GROUP BY p.word_id
    )`,
    [],
    null
  );

  // 每小时学习多少新词（基于最近7天）
  const recentStudyData = firstRow(`
    SELECT
      SUM(wst.seconds) / 3600.0 AS total_hours,
      COUNT(DISTINCT r.word_id) AS new_words
    FROM word_study_time wst
    LEFT JOIN reviews r ON r.reviewed_on = wst.studied_on
      AND r.direction = 'forward'
    WHERE wst.studied_on BETWEEN date(?, '-7 days') AND ?
      AND NOT EXISTS (
        SELECT 1 FROM reviews r2
        WHERE r2.word_id = r.word_id
          AND r2.direction = 'forward'
          AND (r2.reviewed_on < r.reviewed_on OR (r2.reviewed_on = r.reviewed_on AND r2.id < r.id))
      )
  `, [studyDate(), studyDate()]);

  const totalHours = Number(recentStudyData?.total_hours ?? 1);
  const newWords = Number(recentStudyData?.new_words ?? 0);
  const newWordsPerHour = totalHours > 0 ? Math.round(newWords / totalHours) : 0;

  // 7日保持率:只统计真实发生过「两次正向复习间隔至少7天」的答题,
  // 用当次答案判断是否保持住,不再取某一天的 progress 快照,也不看废弃 score。
  const retention = firstRow(`
    SELECT
      SUM(CASE WHEN r.answer IN ('know', 'known_forever') THEN 1 ELSE 0 END) AS retained,
      COUNT(*) AS sample_size
    FROM reviews r
    WHERE r.direction = 'forward'
      AND EXISTS (
        SELECT 1
        FROM reviews prior
        WHERE prior.word_id = r.word_id
          AND prior.direction = 'forward'
          AND (julianday(r.reviewed_on) - julianday(prior.reviewed_on)) >= 7
      )
      AND NOT EXISTS (
        SELECT 1
        FROM reviews same_day
        WHERE same_day.word_id = r.word_id
          AND same_day.direction = 'forward'
          AND same_day.reviewed_on = r.reviewed_on
          AND same_day.id < r.id
          AND EXISTS (
            SELECT 1
            FROM reviews same_day_prior
            WHERE same_day_prior.word_id = same_day.word_id
              AND same_day_prior.direction = 'forward'
              AND (julianday(same_day.reviewed_on) - julianday(same_day_prior.reviewed_on)) >= 7
          )
      )
  `);
  const retentionSampleSize = Number(retention?.sample_size ?? 0);
  const retentionRate = retentionSampleSize > 0
    ? Number(retention?.retained ?? 0) / retentionSampleSize
    : 0;

  // 每次打开分析页都尝试刷新一次画像;满足阈值时不再停在旧的默认 1.0。
  updateMemoryProfileIfNeeded();
  const memoryProfile = getUserMemoryProfile();
  const memoryStrength = memoryProfile.memoryStrength;
  const memoryStrengthLabel = getMemoryStrengthLabel(memoryStrength);

  // 学习效率趋势（简单判断：基于最近的保持率）
  let efficiencyTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (retentionSampleSize > 0 && retentionRate > 0.7) {
    efficiencyTrend = 'improving';
  } else if (retentionSampleSize > 0 && retentionRate < 0.4) {
    efficiencyTrend = 'declining';
  }

  const memorySampleSize = firstValue<number>(
    "SELECT COUNT(*) FROM reviews WHERE direction = 'forward'",
    [],
    0
  );

  return {
    avgReviewsToMaster: avgReviewsToMaster == null ? 0 : Math.round(avgReviewsToMaster * 10) / 10,
    newWordsPerHour,
    retentionRate7Days: Math.round(retentionRate * 100),
    retentionSampleSize,
    efficiencyTrend,
    memoryStrength: Math.round(memoryStrength * 100) / 100,
    memoryStrengthLabel,
    memorySampleSize
  };
}

/**
 * 获取完整的学习分析数据
 */
export function getStudyAnalytics(): StudyAnalytics {
  // 分析页也可能被单独打开,确保读取到 FSRS 列而不是退回旧 score 口径。
  ensureFsrsColumns();
  return {
    studyTime: getStudyTimeAnalytics(),
    mastery: getMasteryAnalytics(),
    errors: getErrorAnalytics(),
    efficiency: getEfficiencyAnalytics(),
    generatedAt: new Date().toISOString()
  };
}
