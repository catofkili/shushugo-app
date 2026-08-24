import { getDatabase } from "../database";
import { ensureUserTables, getState, persistSoon, setState, today } from "../study-core";
import { ensureGrammarProgressInitialized } from "../grammar-api";
import {
  backfillFsrsFromHistory,
  ensureKanjiReadingFsrs,
  ensureFsrsColumns,
  ensureGrammarFsrs,
  migrateRecentDailyEasyReviews,
  migrateFullHistoryDailyEasy
} from "../fsrs-store";

/**
 * 启动初始化。每次进学习页都会跑一遍(幂等):补 progress 行、补 shuffle_rank、
 * 给三个方向建 FSRS 列并一次性回填历史。
 *
 * 以前这里还会「按今天答过的正向词回填反向队列」——那是反向依附正向的年代。
 * 现在反向有自己的当日计划(direction-plan 的 createDirectionTasks),不需要谁来喂。
 *
 * 旧的「每日分数衰减」(连胜梯子)已随 score 系统整体删除 —— 现在间隔完全由 FSRS 的
 * stability/difficulty 决定,不需要每天把所有词扣一遍分。
 */

export const ensureProgressInitialized = () => {
  const db = getDatabase();
  // 种子数据迁移已在启动时(main.tsx 的 ensureSeedData)完成。
  ensureUserTables();
  db.run(`
    INSERT OR IGNORE INTO progress (word_id)
    SELECT id FROM words
  `);
  db.run("UPDATE words SET shuffle_rank = ABS(RANDOM()) / 9223372036854775807.0 WHERE shuffle_rank IS NULL");
  if (!getState("first_study_day", "")) {
    setState("first_study_day", today());
  }
  ensureGrammarProgressInitialized();
  // 三个阶段(单词/汉字/语法)统一由 FSRS 调度:建列 + 一次性回填历史。
  // 各自用 app_state 标记幂等,只跑一次;任一步失败都不能拖垮启动。
  try {
    ensureFsrsColumns();
    backfillFsrsFromHistory();
    migrateRecentDailyEasyReviews();
    // 最初的回填把每次「认识」都按 Good 重放,而实际规则是当天首答认识按 Easy。
    // 几个月的历史累积下来间隔被系统性压短 —— 表现为一次性欠出上千个到期词。
    // 用同一套重放逻辑跑全量历史修正一次。
    migrateFullHistoryDailyEasy();
  } catch (err) {
    console.warn("[fsrs] 单词回填跳过:", err);
  }
  try {
    ensureKanjiReadingFsrs();
  } catch (err) {
    console.warn("[fsrs] 汉字读音建表跳过:", err);
  }
  try {
    ensureGrammarFsrs();
  } catch (err) {
    console.warn("[fsrs] 语法建列跳过:", err);
  }
  // 回填是一次性迁移,幂等标记也写在库里 —— 不落盘的话下次启动会整个重跑一遍。
  persistSoon();
};
