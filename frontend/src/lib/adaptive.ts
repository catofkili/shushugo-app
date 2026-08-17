/**
 * 自适应学习算法
 * 根据用户的学习表现动态调整衰减速度
 */

import { getDatabase } from './database';
import { ensureFsrsColumns, MASTERED_SQL } from './fsrs-store';
import { firstValue, rowsFor, studyDate } from './database/db-utils';

export interface UserMemoryProfile {
  memoryStrength: number;      // 记忆力指数 0.5 - 2.0
  firstTimeCorrectRate: number; // 首次正确率
  retentionRate7Days: number;   // 7天保持率
  avgReviewsToMaster: number;   // 平均掌握次数
  totalReviews: number;         // 总复习次数
  lastUpdated: string;          // 最后更新时间
}

const MEMORY_PROFILE_KEY = 'user_memory_profile';
const MIN_REVIEWS_FOR_ADAPTIVE = 100; // 至少100次复习后才启用自适应
const UPDATE_INTERVAL_REVIEWS = 50;   // 每50次复习更新一次

/**
 * 获取用户记忆画像
 */
export function getUserMemoryProfile(): UserMemoryProfile {
  const value = firstValue<string | null>("SELECT value FROM app_state WHERE key = ?", [MEMORY_PROFILE_KEY], null);
  if (value != null) {
    try {
      return JSON.parse(String(value)) as UserMemoryProfile;
    } catch {
      return getDefaultProfile();
    }
  }

  return getDefaultProfile();
}

/**
 * 默认记忆画像（新用户）
 */
function getDefaultProfile(): UserMemoryProfile {
  return {
    memoryStrength: 1.0,
    firstTimeCorrectRate: 0.5,
    retentionRate7Days: 0.5,
    avgReviewsToMaster: 10,
    totalReviews: 0,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * 保存记忆画像
 */
function saveMemoryProfile(profile: UserMemoryProfile): void {
  const db = getDatabase();
  db.run(`
    INSERT OR REPLACE INTO app_state (key, value)
    VALUES (?, ?)
  `, [MEMORY_PROFILE_KEY, JSON.stringify(profile)]);
}

/**
 * 计算首次正确率
 * 第一次见到单词就答对的比例
 */
function calculateFirstTimeCorrectRate(): number {
  const day = studyDate();
  const row = rowsFor(`
    SELECT
      COUNT(CASE WHEN r.answer IN ('know', 'known_forever') THEN 1 END) AS correct,
      COUNT(*) AS total
    FROM reviews r
    WHERE r.direction = 'forward'
      AND r.reviewed_on BETWEEN date(?, '-30 days') AND ?
      AND NOT EXISTS (
        SELECT 1
        FROM reviews prior
        WHERE prior.word_id = r.word_id
          AND prior.direction = 'forward'
          AND (prior.reviewed_on < r.reviewed_on OR (prior.reviewed_on = r.reviewed_on AND prior.id < r.id))
      )
  `, [day, day])[0];
  if (!row) return 0.5;
  const correct = Number(row.correct ?? 0);
  const total = Number(row.total ?? 0);
  if (total === 0) return 0.5;

  return correct / total;
}

/**
 * 计算7天保持率
 * 7天前学的词，现在还记得的比例
 */
function calculateRetentionRate7Days(): number {
  ensureFsrsColumns();
  // 只统计真实发生过「两次正向复习间隔至少7天」的答题,
  // 用当次答案判断是否保持住,不再取 progress 的某一天快照。
  const row = rowsFor(`
    SELECT
      COUNT(CASE WHEN r.answer IN ('know', 'known_forever') THEN 1 END) AS retained,
      COUNT(*) AS total
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
  `)[0];
  if (!row) return 0.5;
  const retained = Number(row.retained ?? 0);
  const total = Number(row.total ?? 0);
  if (total === 0) return 0.5;

  return retained / total;
}

/**
 * 计算平均需要复习几次才能「掌握」。
 * 掌握的口径跟 FSRS 走:下次间隔已经排到一周以外(记牢了才排得这么远),
 * 不再看已废弃的 score >= 10。
 */
function calculateAvgReviewsToMaster(): number {
  ensureFsrsColumns();
  const avgReviews = firstValue<number | null>(`
    SELECT
      AVG(review_count) AS avg_reviews
    FROM (
      SELECT p.word_id, COUNT(r.id) AS review_count
      FROM progress p
      JOIN reviews r ON r.word_id = p.word_id AND r.direction = 'forward'
      WHERE p.known_forever = 1 OR ${MASTERED_SQL}
      GROUP BY p.word_id
    )
  `, [], null);
  return Number(avgReviews) || 10;
}

/**
 * 获取总复习次数
 */
function getTotalReviewCount(): number {
  return firstValue<number>("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'", [], 0);
}

/**
 * 计算记忆力指数
 * 综合多个指标，归一化到 0.5-2.0
 */
function calculateMemoryStrength(
  firstTimeCorrectRate: number,
  retentionRate7Days: number,
  avgReviewsToMaster: number
): number {
  // 首次正确率权重 30%
  const firstTimeScore = firstTimeCorrectRate * 0.3;

  // 保持率权重 40%
  const retentionScore = retentionRate7Days * 0.4;

  // 平均复习次数权重 30%（次数越少越好，所以取倒数）
  const reviewsScore = Math.min(1, 5 / avgReviewsToMaster) * 0.3;

  // 综合得分 0-1
  const combinedScore = firstTimeScore + retentionScore + reviewsScore;

  // 映射到 0.5-2.0 范围
  // 0.0 -> 0.5 (记忆力很弱)
  // 0.5 -> 1.0 (记忆力正常)
  // 1.0 -> 2.0 (记忆力很强)
  return 0.5 + combinedScore * 1.5;
}

/**
 * 更新用户记忆画像
 * 每50次复习更新一次
 */
export function updateMemoryProfileIfNeeded(): void {
  const currentProfile = getUserMemoryProfile();
  const totalReviews = getTotalReviewCount();

  // 至少100次复习后才开始计算
  if (totalReviews < MIN_REVIEWS_FOR_ADAPTIVE) {
    return;
  }

  // 检查是否需要更新（每50次复习更新一次）
  const reviewsSinceLastUpdate = totalReviews - currentProfile.totalReviews;
  if (reviewsSinceLastUpdate < UPDATE_INTERVAL_REVIEWS) {
    return;
  }

  // 重新计算各项指标
  const firstTimeCorrectRate = calculateFirstTimeCorrectRate();
  const retentionRate7Days = calculateRetentionRate7Days();
  const avgReviewsToMaster = calculateAvgReviewsToMaster();
  const memoryStrength = calculateMemoryStrength(
    firstTimeCorrectRate,
    retentionRate7Days,
    avgReviewsToMaster
  );

  // 保存新的画像
  const newProfile: UserMemoryProfile = {
    memoryStrength,
    firstTimeCorrectRate,
    retentionRate7Days,
    avgReviewsToMaster,
    totalReviews,
    lastUpdated: new Date().toISOString()
  };

  saveMemoryProfile(newProfile);

  console.log('📊 记忆画像已更新:', {
    memoryStrength: memoryStrength.toFixed(2),
    firstTimeCorrectRate: (firstTimeCorrectRate * 100).toFixed(1) + '%',
    retentionRate7Days: (retentionRate7Days * 100).toFixed(1) + '%',
    avgReviewsToMaster: avgReviewsToMaster.toFixed(1)
  });
}

/*
 * 注:calculateAdaptiveDecay / calculateDefaultDecay 已随每日分数衰减引擎一起删除。
 * 间隔现在完全由 FSRS 的 stability/difficulty 决定,不存在"每天扣多少分"这回事。
 * 记忆画像保留下来只用于统计页展示。
 */

/**
 * 获取用户学习能力评级（用于显示）
 */
export function getMemoryStrengthLabel(strength: number): string {
  if (strength >= 1.5) return '优秀';
  if (strength >= 1.2) return '良好';
  if (strength >= 0.8) return '正常';
  return '需加强';
}
