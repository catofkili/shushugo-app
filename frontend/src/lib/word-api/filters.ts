import type { SqlValue } from "../study-core";
import type { WordSessionOptions } from "../study-types";

/**
 * 「筛选学习」的 WHERE 片段:等级 + 词性/收藏。
 * 出题和统计都要按同一套条件过滤,抽出来共用,免得两边口径漂移。
 */

export const wordFilterSql = (options: WordSessionOptions = {}, alias = "w") => {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const level = options.level ?? "All";
  const type = options.type ?? "all";

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
  (options.level ?? "All") !== "All" || (options.type ?? "all") !== "all"
);

