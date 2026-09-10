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
  // 「这一条是不是这个词的第一次正向作答」用窗口函数一遍排名算完。
  // 原来是 NOT EXISTS 相关子查询,等于对每条流水再扫一遍全表 —— 见下面
  // calculateRetentionRate7Days 上那段。结果与旧写法逐字段一致(adaptive.test.ts 钉住)。
  const row = rowsFor(`
    WITH ranked AS (
      SELECT
        r.reviewed_on,
        r.answer,
        ROW_NUMBER() OVER (PARTITION BY r.word_id ORDER BY r.reviewed_on, r.id) AS rn
      FROM reviews r
      WHERE r.direction = 'forward'
    )
    SELECT
      COUNT(CASE WHEN answer IN ('know', 'known_forever') THEN 1 END) AS correct,
      COUNT(*) AS total
    FROM ranked
    WHERE rn = 1
      AND reviewed_on BETWEEN date(?, '-30 days') AND ?
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
  // ⚠️ 这条曾经是整个应用最长的一次卡顿:三层相关子查询 + julianday(),在 46,618 条
  // reviews 上单次 **3.8 秒**(sql.js 实测),而它每 50 次作答就在评分的同步栈里跑一次。
  //
  // 等价改写成两个聚合:
  //   ① 「存在一条至少早 7 天的同词流水」⟺「这个词最早那条流水早了 7 天以上」——
  //      所以 EXISTS 折叠成 MIN(reviewed_on)。
  //   ② 那层 NOT EXISTS 的意思只是「同一天同一个词只算第一条」,因为是否合格
  //      只取决于 (word_id, reviewed_on),同一天的几条要么全合格要么全不合格 ——
  //      所以折叠成按 (word_id, reviewed_on) 的 ROW_NUMBER() = 1。
  // 在真实库上与旧写法结果完全相同(retained 6525 / total 14242),native sqlite
  // 448ms → 47ms。adaptive.test.ts 里用旧 SQL 对拍钉住这条等价性。
  const row = rowsFor(`
    WITH first_day AS (
      SELECT word_id, MIN(reviewed_on) AS d0
      FROM reviews
      WHERE direction = 'forward'
      GROUP BY word_id
    ), day_firsts AS (
      SELECT
        r.word_id,
        r.reviewed_on,
        r.answer,
        ROW_NUMBER() OVER (PARTITION BY r.word_id, r.reviewed_on ORDER BY r.id) AS rn
      FROM reviews r
      WHERE r.direction = 'forward'
    )
    SELECT
      COUNT(CASE WHEN f.answer IN ('know', 'known_forever') THEN 1 END) AS retained,
      COUNT(*) AS total
    FROM day_firsts f
    JOIN first_day fd ON fd.word_id = f.word_id
    WHERE f.rn = 1
      AND julianday(f.reviewed_on) - julianday(fd.d0) >= 7
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
