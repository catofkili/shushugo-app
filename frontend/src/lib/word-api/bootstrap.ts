import { getDatabase } from "../database";
import {
  CRITICAL_SCORE,
  daysSince,
  DbRow,
  ensureUserTables,
  getState,
  rowsFor,
  setState,
  today
} from "../study-core";
import { applyLadderDecay, ladderDecayRate } from "../streak-ladder";
import { applyGrammarDailyDecay, ensureGrammarProgressInitialized } from "../grammar-api";
import { backfillFsrsFromHistory, ensureFsrsColumns, isFsrsActive } from "../fsrs-store";
import { backfillStage2FromReviews } from "./queues";

/**
 * 启动初始化 + 每日衰减。
 * 每次进学习页都会跑一遍(幂等):补 progress 行、补 shuffle_rank、
 * 回填 Stage2、跑老算法的每日分数衰减(FSRS 生效时整体跳过)、建 FSRS 列并回填历史。
 *
 * 从 word-api.ts 原样搬出,逻辑一字未改。
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
  db.run("UPDATE progress SET score = 0 WHERE seen_count = 0 AND score < 0");
  if (!getState("first_study_day", "")) {
    setState("first_study_day", today());
  }
  ensureGrammarProgressInitialized();
  backfillStage2FromReviews();
  applyDailyDecay();
  applyGrammarDailyDecay();
  // 阶段 P0(影子模式):建 FSRS 列并把历史一次性回填。只写不读,零可见变化。
  try {
    ensureFsrsColumns();
    backfillFsrsFromHistory();
  } catch (err) {
    console.warn("[fsrs] 回填跳过:", err);
  }
};

const ladderRowOf = (row: DbRow) => ({
  importance: Number(row.importance ?? 3),
  right_count: Number(row.right_count ?? 0),
  fuzzy_count: Number(row.fuzzy_count ?? 0),
  forgot_count: Number(row.forgot_count ?? 0),
  right_streak: Number(row.right_streak ?? 0)
});

const backfillCriticalReviews = (beforeDay: string) => {
  getDatabase().run(`
    INSERT OR IGNORE INTO critical_reviews (reviewed_on, word_id)
    SELECT reviewed_on, word_id
    FROM reviews
    WHERE reviewed_on < ?
      AND score_after <= ?
  `, [beforeDay, CRITICAL_SCORE]);
};

const resetPreviousCriticalReviews = (day: string) => {
  const db = getDatabase();
  db.run(`
    UPDATE progress
    SET score = -1,
        mastered_on = NULL
    WHERE known_forever = 0
      AND word_id IN (
        SELECT word_id
        FROM critical_reviews
        WHERE reviewed_on < ?
          AND reset_on IS NULL
      )
  `, [day]);
  db.run(`
    UPDATE critical_reviews
    SET reset_on = ?
    WHERE reviewed_on < ?
      AND reset_on IS NULL
  `, [day, day]);
};

const applyDailyDecay = () => {
  // 老算法已关闭:FSRS 生效时不再跑每日分数衰减(score 不再被读,衰减纯属空转且会一夜灌爆积压)。
  if (isFsrsActive()) return;
  const day = today();
  const lastDecay = getState("last_decay", "");
  if (!lastDecay) {
    setState("last_decay", day);
    return;
  }
  if (lastDecay === day) return;
  // 隔多天打开也按实际天数补衰减(封顶 60,防异常日期)
  const steps = Math.min(Math.max(daysSince(lastDecay), 1), 60);

  const db = getDatabase();
  const rows = rowsFor(`
    SELECT w.importance, p.*
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND p.seen_count > 0
  `);

  rows.forEach((row) => {
    const rate = ladderDecayRate(ladderRowOf(row));
    const next = applyLadderDecay(Number(row.score ?? 0), rate * steps);
    db.run(`
      UPDATE progress
      SET score = ?,
          mastered_on = NULL,
          last_decay_amount = ?
      WHERE word_id = ?
    `, [next, Math.round(rate * 10), Number(row.word_id)]);
  });

  backfillCriticalReviews(day);
  resetPreviousCriticalReviews(day);
  setState("last_decay", day);
};
