import entries from "../data/collocation_tier_index.json";

export type CollocationTier = "core" | "common" | "optional";
export const collocationTier = (entry: { t?: number }): CollocationTier =>
  entry.t === 0 ? "core" : entry.t === 2 ? "optional" : "common";

const key = (surface: string, kana: string) => `${surface}\u001f${kana}`;
const tiers = new Map(Object.entries(entries).flatMap(([tier, rows]) => rows.map((row) => [
  typeof row === "string" ? key(row, row) : key(row[0], row[1]), tier as CollocationTier
] as const)));

export const wordCollocationTier = (word: { kanji?: unknown; kana?: unknown; pos?: unknown }): CollocationTier | null =>
  word.pos === "固定搭配" ? tiers.get(key(String(word.kanji ?? ""), String(word.kana ?? ""))) ?? "common" : null;

// 无相关子查询：SQLite 每条语句只构造一次 ID 集合。按实际词形匹配，不依赖迁移/自增 ID，
// 也不用 export() 后会消失的 TEMP 表或在导入/合并后可能过期的 JS ID 缓存。
const tierIds = Object.fromEntries((["core", "optional"] as const).map((tier) => {
  const keys = JSON.stringify([...tiers].filter(([, value]) => value === tier).map(([value]) => value)).replace(/'/g, "''");
  return [tier, `SELECT id FROM words WHERE pos = '固定搭配' AND kanji || char(31) || kana IN (SELECT value FROM json_each('${keys}'))`];
})) as Record<"core" | "optional", string>;

export const collocationIdsSql = (tier: CollocationTier): string => tier === "common"
  ? `SELECT id FROM words WHERE pos = '固定搭配' AND id NOT IN (${tierIds.core}) AND id NOT IN (${tierIds.optional})`
  : tierIds[tier];
export const optionalWordSql = (id: string) => `${id} IN (${tierIds.optional})`;
export const newWordTierRankSql = (id: string) => `CASE
  WHEN ${id} IN (${tierIds.core}) THEN 0
  WHEN ${optionalWordSql(id)} THEN 3
  WHEN ${id} IN (SELECT id FROM words WHERE pos = '固定搭配') THEN 2 ELSE 1 END`;
