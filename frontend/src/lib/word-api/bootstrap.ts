import { getDatabase } from "../database";
import { ensureUserTables, getState, persistSoon, setState, today } from "../study-core";
import { ensureGrammarProgressInitialized } from "../grammar-api";
import {
  backfillFsrsFromHistory,
  backfillKanjiFsrs,
  ensureFsrsColumns,
  ensureGrammarFsrs,
  migrateRecentDailyEasyReviews
} from "../fsrs-store";
import { backfillStage2FromReviews } from "./queues";

/**
 * 启动初始化。每次进学习页都会跑一遍(幂等):补 progress 行、补 shuffle_rank、
 * 回填 Stage2、给三个阶段建 FSRS 列并一次性回填历史。
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
  backfillStage2FromReviews();
  // 三个阶段(单词/汉字/语法)统一由 FSRS 调度:建列 + 一次性回填历史。
  // 各自用 app_state 标记幂等,只跑一次;任一步失败都不能拖垮启动。
  try {
    ensureFsrsColumns();
    backfillFsrsFromHistory();
    migrateRecentDailyEasyReviews();
  } catch (err) {
    console.warn("[fsrs] 单词回填跳过:", err);
  }
  try {
    backfillKanjiFsrs();
  } catch (err) {
    console.warn("[fsrs] 汉字回填跳过:", err);
  }
  try {
    ensureGrammarFsrs();
  } catch (err) {
    console.warn("[fsrs] 语法建列跳过:", err);
  }
  // 回填是一次性迁移,幂等标记也写在库里 —— 不落盘的话下次启动会整个重跑一遍。
  persistSoon();
};
