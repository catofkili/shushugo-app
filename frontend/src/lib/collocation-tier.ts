export type CollocationTier = "core" | "common" | "optional";
export const collocationTier = (entry: { t?: number }): CollocationTier =>
  entry.t === 0 ? "core" : entry.t === 2 ? "optional" : "common";

// colloc-daily 的测试仍导入此函数；调用方需 SELECT collocation_tier，不再按词形查索引。
export const wordCollocationTier = (word: { kanji?: unknown; kana?: unknown; pos?: unknown; collocation_tier?: unknown }): CollocationTier | null =>
  word.pos === "固定搭配" ? collocationTier({ t: word.collocation_tier as number | undefined }) : null;

// 保留 word_id 参数接口，供各分支的任意别名/表达式调用；NULL 搭配按 common 处理。
export const optionalWordSql = (id: string) =>
  `${id} IN (SELECT id FROM words WHERE pos = '固定搭配' AND collocation_tier = 2)`;
export const newWordTierRankSql = (id: string) => `CASE
  WHEN ${id} IN (SELECT id FROM words WHERE pos = '固定搭配' AND collocation_tier = 0) THEN 0
  WHEN ${optionalWordSql(id)} THEN 3
  WHEN ${id} IN (SELECT id FROM words WHERE pos = '固定搭配') THEN 2 ELSE 1 END`;
