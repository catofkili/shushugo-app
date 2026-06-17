/**
 * 学习分析数据模块
 */

import { firstRow, firstValue, rowsFor, studyDate } from "../database/db-utils";
import { getUserMemoryProfile, getMemoryStrengthLabel } from "../adaptive";

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
  mastered: number;
  learning: number;
  struggling: number;
  percentage: number;
}

export interface PosMastery {
  pos: string;
  avgScore: number;
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
  score: number;
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
  efficiencyTrend: 'improving' | 'stable' | 'declining';
  memoryStrength: number;
  memoryStrengthLabel: string;
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
  // 最近30天的学习时长
  const dailyMinutes = rowsFor(`
    SELECT
      studied_on AS date,
      CAST(seconds / 60.0 AS INTEGER) AS minutes,
      0 AS wordCount
    FROM word_study_time
    WHERE studied_on >= date('now', '-30 days')
    ORDER BY studied_on DESC
  `).map(row => ({
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
  // 按 JLPT 等级统计
  const byLevel = rowsFor(`
    SELECT
      COALESCE(w.jlpt_level, '未分级') AS level,
      COUNT(*) AS total,
      SUM(CASE WHEN p.score >= 10 THEN 1 ELSE 0 END) AS mastered,
      SUM(CASE WHEN p.score > 0 AND p.score < 10 THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN p.score <= 0 THEN 1 ELSE 0 END) AS struggling
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
    const mastered = Number(row.mastered ?? 0);
    return {
      level: String(row.level),
      total,
      mastered,
      learning: Number(row.learning ?? 0),
      struggling: Number(row.struggling ?? 0),
      percentage: total > 0 ? Math.round((mastered / total) * 100) : 0
    };
  });

  // 按词性统计
  const byPartOfSpeech = rowsFor(`
    SELECT
      CASE
        WHEN pos LIKE '%名%' THEN '名词'
        WHEN pos LIKE '%動%' OR pos LIKE '%动%' THEN '动词'
        WHEN pos LIKE '%形%' THEN '形容词'
        WHEN pos LIKE '%副%' THEN '副词'
        ELSE '其他'
      END AS pos,
      AVG(p.score) AS avgScore,
      COUNT(*) AS count,
      SUM(CASE WHEN p.score >= 10 THEN 1 ELSE 0 END) AS masteredCount
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE p.seen_count > 0
    GROUP BY pos
    ORDER BY count DESC
    LIMIT 5
  `).map(row => ({
    pos: String(row.pos),
    avgScore: Math.round(Number(row.avgScore ?? 0) * 10) / 10,
    count: Number(row.count ?? 0),
    masteredCount: Number(row.masteredCount ?? 0)
  }));

  // 预计完成天数（简单计算）
  const estimatedDaysToComplete: Record<string, number> = {};
  const avgNewWordsPerDay = firstValue<number>(
    `SELECT AVG(daily_new) FROM (
      SELECT COUNT(DISTINCT word_id) AS daily_new
      FROM reviews
      WHERE reviewed_on >= date('now', '-7 days')
      GROUP BY reviewed_on
    )`,
    [],
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
      p.score,
      p.forgot_count,
      p.fuzzy_count,
      p.right_count,
      (p.forgot_count * 2 + p.fuzzy_count) AS wrong_count,
      p.seen_count AS totalReviews
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE p.seen_count >= 3
      AND p.known_forever = 0
    ORDER BY
      (p.forgot_count * 2.0 + p.fuzzy_count) / NULLIF(p.seen_count, 0) DESC,
      p.score ASC
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
      score: Number(row.score ?? 0)
    };
  });

  // 错误类型分布
  const errorDist = firstRow(`
    SELECT
      SUM(forgot_count) AS forgot,
      SUM(fuzzy_count) AS fuzzy,
      SUM(right_count) AS know
    FROM progress
    WHERE seen_count > 0
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
  // 平均需要复习几次才能掌握
  const avgReviewsToMaster = firstValue<number>(
    `SELECT AVG(seen_count) FROM progress WHERE score >= 10 AND seen_count > 0`,
    [],
    10
  );

  // 每小时学习多少新词（基于最近7天）
  const recentStudyData = firstRow(`
    SELECT
      SUM(wst.seconds) / 3600.0 AS total_hours,
      COUNT(DISTINCT r.word_id) AS new_words
    FROM word_study_time wst
    LEFT JOIN reviews r ON r.reviewed_on = wst.studied_on
    WHERE wst.studied_on >= date('now', '-7 days')
      AND NOT EXISTS (
        SELECT 1 FROM reviews r2
        WHERE r2.word_id = r.word_id AND r2.reviewed_on < r.reviewed_on
      )
  `);

  const totalHours = Number(recentStudyData?.total_hours ?? 1);
  const newWords = Number(recentStudyData?.new_words ?? 0);
  const newWordsPerHour = totalHours > 0 ? Math.round(newWords / totalHours) : 0;

  // 7天保持率
  const retentionRate7Days = firstValue<number>(
    `SELECT
      CAST(SUM(CASE WHEN score > 0 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0)
    FROM progress
    WHERE last_seen_on = date('now', '-7 days')
      AND known_forever = 0`,
    [],
    0.5
  );

  // 获取记忆力指数
  const memoryProfile = getUserMemoryProfile();
  const memoryStrength = memoryProfile.memoryStrength;
  const memoryStrengthLabel = getMemoryStrengthLabel(memoryStrength);

  // 学习效率趋势（简单判断：基于最近的保持率）
  let efficiencyTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (retentionRate7Days > 0.7) {
    efficiencyTrend = 'improving';
  } else if (retentionRate7Days < 0.4) {
    efficiencyTrend = 'declining';
  }

  return {
    avgReviewsToMaster: Math.round(avgReviewsToMaster * 10) / 10,
    newWordsPerHour,
    retentionRate7Days: Math.round(retentionRate7Days * 100),
    efficiencyTrend,
    memoryStrength: Math.round(memoryStrength * 100) / 100,
    memoryStrengthLabel
  };
}

/**
 * 获取完整的学习分析数据
 */
export function getStudyAnalytics(): StudyAnalytics {
  return {
    studyTime: getStudyTimeAnalytics(),
    mastery: getMasteryAnalytics(),
    errors: getErrorAnalytics(),
    efficiency: getEfficiencyAnalytics(),
    generatedAt: new Date().toISOString()
  };
}
