/**
 * 测试工具函数
 * 仅用于开发测试
 */

import { getDatabase } from './database';
import { today } from './database/db-utils';

/**
 * 快速完成今日任务（测试用）
 *
 * 将今日所有 Stage 1 任务的单词设置为 score = 9
 * 然后获取下一个单词，点"认识"后就会进入完成页面
 */
export function quickCompleteToday(): void {
  const db = getDatabase();
  const day = today();

  // 1. 将所有今日任务的单词设置为 score = 9
  db.run(`
    UPDATE progress
    SET score = 9,
        seen_count = seen_count + 1,
        last_seen_on = ?
    WHERE word_id IN (
      SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?
    )
      AND known_forever = 0
  `, [day, day]);

  // 2. 创建模拟的复习记录
  db.run(`
    INSERT INTO reviews (word_id, answer, score_after, reviewed_on)
    SELECT word_id, 'know', 9, ?
    FROM stage1_tasks
    WHERE reviewed_on = ?
      AND NOT EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.word_id = stage1_tasks.word_id
          AND r.reviewed_on = ?
      )
  `, [day, day, day]);

  console.log('✅ 测试模式：今日任务已接近完成，下一个单词点"认识"即可进入完成页面');
}

/**
 * 重置今日任务（测试用）
 * 清除今日所有进度，重新开始
 */
export function resetTodayProgress(): void {
  const db = getDatabase();
  const day = today();

  // 删除今日任务
  db.run('DELETE FROM stage1_tasks WHERE reviewed_on = ?', [day]);

  // 删除今日复习记录
  db.run('DELETE FROM reviews WHERE reviewed_on = ?', [day]);

  // 删除今日打卡
  db.run('DELETE FROM checkins WHERE checked_on = ?', [day]);

  // 删除今日学习时长
  db.run('DELETE FROM word_study_time WHERE studied_on = ?', [day]);

  console.log('✅ 测试模式：今日进度已重置');
}

/**
 * 模拟记忆力数据（测试用）
 * 生成足够的历史数据以启用自适应算法
 */
export function simulateMemoryData(memoryType: 'strong' | 'normal' | 'weak'): void {
  const db = getDatabase();

  // 配置不同记忆力的参数
  const config = {
    strong: { firstCorrect: 0.8, retention: 0.8, avgReviews: 5 },
    normal: { firstCorrect: 0.5, retention: 0.5, avgReviews: 10 },
    weak: { firstCorrect: 0.3, retention: 0.3, avgReviews: 15 }
  };

  const params = config[memoryType];

  // 获取前200个单词
  const words = db.exec(`
    SELECT id FROM words ORDER BY id LIMIT 200
  `);

  if (!words.length || !words[0].values.length) {
    console.error('❌ 没有找到单词数据');
    return;
  }

  const wordIds = words[0].values.map(row => row[0] as number);

  // 模拟复习记录
  wordIds.forEach((wordId, index) => {
    const seenCount = Math.floor(Math.random() * params.avgReviews) + params.avgReviews;
    const isFirstCorrect = Math.random() < params.firstCorrect;
    const finalScore = Math.random() < params.retention ?
      Math.floor(Math.random() * 5) + 5 :
      Math.floor(Math.random() * 3) - 1;

    // 更新进度
    db.run(`
      UPDATE progress
      SET seen_count = ?,
          score = ?,
          right_count = ?,
          fuzzy_count = ?,
          forgot_count = ?,
          last_seen_on = date('now', '-7 days')
      WHERE word_id = ?
    `, [
      seenCount,
      finalScore,
      Math.floor(seenCount * 0.6),
      Math.floor(seenCount * 0.3),
      Math.floor(seenCount * 0.1),
      wordId
    ]);

    // 添加复习记录（触发自适应算法需要100+条）
    if (index < 150) {
      db.run(`
        INSERT INTO reviews (word_id, answer, score_after, reviewed_on)
        VALUES (?, ?, ?, date('now', '-' || ? || ' days'))
      `, [
        wordId,
        isFirstCorrect ? 'know' : 'fuzzy',
        finalScore,
        Math.floor(Math.random() * 30)
      ]);
    }
  });

  console.log(`✅ 测试模式：已模拟 ${memoryType} 记忆力数据，自适应算法已启用`);
}

/**
 * 查看当前记忆力状态（测试用）
 */
export function checkMemoryStatus(): void {
  const db = getDatabase();

  // 检查总复习次数
  const totalReviews = db.exec('SELECT COUNT(*) FROM reviews');
  const count = totalReviews[0]?.values[0]?.[0] as number || 0;

  console.log('📊 记忆力状态检查：');
  console.log(`  总复习次数: ${count}`);
  console.log(`  自适应算法: ${count >= 100 ? '✅ 已启用' : '❌ 未启用（需要100次）'}`);

  if (count >= 100) {
    // 读取记忆画像
    const profile = db.exec(`SELECT value FROM app_state WHERE key = 'user_memory_profile'`);
    if (profile.length && profile[0].values.length) {
      const data = JSON.parse(profile[0].values[0][0] as string);
      console.log('  记忆力指数:', data.memoryStrength?.toFixed(2));
      console.log('  首次正确率:', (data.firstTimeCorrectRate * 100).toFixed(1) + '%');
      console.log('  7天保持率:', (data.retentionRate7Days * 100).toFixed(1) + '%');
      console.log('  平均掌握次数:', data.avgReviewsToMaster?.toFixed(1));
    }
  }
}
