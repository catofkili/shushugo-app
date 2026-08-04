import type { SqlValue } from "../study-core";
import type { WordSessionOptions } from "../study-types";

/**
 * 「筛选学习」的 WHERE 片段:等级 + 词性/收藏 + 学习重点。
 * 出题和统计都要按同一套条件过滤,抽出来共用,免得两边口径漂移。
 */

export const MISTAKE_MIN_REVIEWS = 4;
export const MISTAKE_MIN_LAPSES = 2;
export const MISTAKE_MIN_DIFFICULTY = 7;
export const MISTAKE_MIN_WRONG_ANSWERS = 2;
export const MISTAKE_MIN_ERROR_RATE = 0.4;

/**
 * 「长期不会」不是一两次临时答错，而是满足以下任一长期信号：
 * 1. FSRS 已记录至少两次遗忘；2. 多次复习后难度仍很高；
 * 3. 历史上的忘记/模糊答案持续占比较高。
 */
export const mistakeCandidateSql = (progressAlias = "p") => `(
  ${progressAlias}.seen_count >= ${MISTAKE_MIN_REVIEWS}
  AND (
    COALESCE(${progressAlias}.fsrs_lapses, 0) >= ${MISTAKE_MIN_LAPSES}
    OR (
      COALESCE(${progressAlias}.fsrs_reps, 0) >= ${MISTAKE_MIN_REVIEWS}
      AND COALESCE(${progressAlias}.fsrs_difficulty, 0) >= ${MISTAKE_MIN_DIFFICULTY}
    )
    OR (
      COALESCE(${progressAlias}.forgot_count, 0) + COALESCE(${progressAlias}.fuzzy_count, 0) >= ${MISTAKE_MIN_WRONG_ANSWERS}
      AND (
        COALESCE(${progressAlias}.forgot_count, 0) * 2.0 + COALESCE(${progressAlias}.fuzzy_count, 0)
      ) / MAX(
        COALESCE(${progressAlias}.right_count, 0) + COALESCE(${progressAlias}.forgot_count, 0) * 2.0 + COALESCE(${progressAlias}.fuzzy_count, 0),
        1
      ) >= ${MISTAKE_MIN_ERROR_RATE}
    )
  )
)`;

export const wordFilterSql = (options: WordSessionOptions = {}, alias = "w", progressAlias = "p") => {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const level = options.level ?? "All";
  const type = options.type ?? "all";

  if (options.focus === "mistakes") {
    clauses.push(mistakeCandidateSql(progressAlias));
  }

  if (level !== "All") {
    if (level === "Unleveled") {
      clauses.push(`(${alias}.jlpt_level IS NULL OR ${alias}.jlpt_level = '')`);
    } else {
      clauses.push(`${alias}.jlpt_level = ?`);
      params.push(level);
    }
  }

  if (type === "favorite") {
    clauses.push(`EXISTS (
      SELECT 1 FROM content_favorites cf
      WHERE cf.item_type = 'word' AND cf.item_id = CAST(${alias}.id AS TEXT)
    )`);
  } else if (type === "noun") {
    clauses.push(`(${alias}.pos LIKE '%名%' OR ${alias}.pos LIKE '%名词%')`);
  } else if (type === "verb") {
    clauses.push(`(
      ${alias}.pos LIKE '%動%' OR
      ${alias}.pos LIKE '%动词%' OR
      ${alias}.pos LIKE '%自动%' OR
      ${alias}.pos LIKE '%他动%' OR
      ${alias}.pos LIKE '%自動%' OR
      ${alias}.pos LIKE '%他動%'
    )`);
  } else if (type === "adjective") {
    clauses.push(`(${alias}.pos LIKE '%形%' OR ${alias}.pos LIKE '%形容词%')`);
  } else if (type === "adverb") {
    clauses.push(`(${alias}.pos LIKE '%副%' OR ${alias}.pos LIKE '%副词%')`);
  }

  return {
    clause: clauses.length ? ` AND ${clauses.join(" AND ")} ` : "",
    params
  };
};

export const hasWordFilter = (options: WordSessionOptions = {}) => (
  (options.level ?? "All") !== "All"
  || (options.type ?? "all") !== "all"
  || options.focus === "mistakes"
);
