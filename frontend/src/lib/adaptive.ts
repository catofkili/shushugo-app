/**
 * 自适应学习算法
 * 根据用户的学习表现动态调整衰减速度
 */

import { getDatabase } from './database';

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
  const db = getDatabase();
  const result = db.exec(`
    SELECT value FROM app_state WHERE key = ?
  `, [MEMORY_PROFILE_KEY]);

  if (result.length && result[0].values.length) {
    try {
      return JSON.parse(String(result[0].values[0][0])) as UserMemoryProfile;
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
  const db = getDatabase();
  const result = db.exec(`
    SELECT
      COUNT(CASE WHEN r.answer IN ('know', 'known_forever') THEN 1 END) AS correct,
      COUNT(*) AS total
    FROM reviews r
    JOIN progress p ON p.word_id = r.word_id
    WHERE p.seen_count = 1
      AND r.reviewed_on >= date('now', '-30 days')
  `);

  if (!result.length || !result[0].values.length) return 0.5;

  const [correct, total] = result[0].values[0] as [number, number];
  if (total === 0) return 0.5;

  return correct / total;
}

/**
 * 计算7天保持率
 * 7天前学的词，现在还记得的比例
 */
function calculateRetentionRate7Days(): number {
  const db = getDatabase();
  const result = db.exec(`
    SELECT
      COUNT(CASE WHEN p.score > 0 THEN 1 END) AS retained,
      COUNT(*) AS total
    FROM progress p
    WHERE p.last_seen_on = date('now', '-7 days')
      AND p.known_forever = 0
  `);

  if (!result.length || !result[0].values.length) return 0.5;

  const [retained, total] = result[0].values[0] as [number, number];
  if (total === 0) return 0.5;

  return retained / total;
}

/**
 * 计算平均需要复习几次才能掌握（score >= 10）
 */
function calculateAvgReviewsToMaster(): number {
  const db = getDatabase();
  const result = db.exec(`
    SELECT
      AVG(p.seen_count) AS avg_reviews
    FROM progress p
    WHERE p.score >= 10
      AND p.seen_count > 0
  `);

  if (!result.length || !result[0].values.length) return 10;

  const avgReviews = result[0].values[0][0] as number;
  return avgReviews || 10;
}

/**
 * 获取总复习次数
 */
function getTotalReviewCount(): number {
  const db = getDatabase();
  const result = db.exec(`SELECT COUNT(*) FROM reviews`);

  if (!result.length || !result[0].values.length) return 0;
  return result[0].values[0][0] as number;
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

/**
 * 计算自适应衰减量（每天）
 *
 * @param importance 单词重要度 1-5
 * @param mistakeScore 错误率 0-1
 * @returns 衰减量（分数）
 */
export function calculateAdaptiveDecay(
  importance: number,
  mistakeScore: number
): number {
  const profile = getUserMemoryProfile();
  const totalReviews = getTotalReviewCount();

  // 如果复习次数不足100次，使用默认衰减
  if (totalReviews < MIN_REVIEWS_FOR_ADAPTIVE) {
    return calculateDefaultDecay(importance, mistakeScore);
  }

  // 基础衰减 1.0 分/天
  const baseDecay = 1.0;

  // 重要度调整 -0.2 到 +0.2
  const importanceAdjust = (importance - 3) * 0.1;

  // 错误率调整 0 到 +0.2
  const mistakeAdjust = mistakeScore * 0.2;

  // 记忆力调整 0.5 到 2.0
  // 记忆力强 (2.0) -> 衰减快（需要更多挑战）
  // 记忆力弱 (0.5) -> 衰减慢（需要更多巩固）
  const memoryAdjust = profile.memoryStrength;

  // 最终衰减 = 基础 * 记忆力系数 + 重要度 + 错误率
  const finalDecay = baseDecay * memoryAdjust + importanceAdjust + mistakeAdjust;

  // 限制在 0.5-2.0 范围
  return Math.max(0.5, Math.min(2.0, finalDecay));
}

/**
 * 默认衰减算法（用于新用户）
 */
function calculateDefaultDecay(importance: number, mistakeScore: number): number {
  const baseDecay = 1.0;
  const importanceAdjust = (importance - 3) * 0.1;
  const mistakeAdjust = mistakeScore * 0.2;

  const finalDecay = baseDecay + importanceAdjust + mistakeAdjust;
  return Math.max(0.8, Math.min(1.2, finalDecay));
}

/**
 * 获取用户学习能力评级（用于显示）
 */
export function getMemoryStrengthLabel(strength: number): string {
  if (strength >= 1.5) return '优秀';
  if (strength >= 1.2) return '良好';
  if (strength >= 0.8) return '正常';
  return '需加强';
}
