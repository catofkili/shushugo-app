/**
 * 易混词识别算法
 */

import { WordCard } from "../../types/vocabulary";
import { DbRow, rowsFor } from "../database/db-utils";

const senseGroups = [
  {
    keys: new Set(["食べる", "たべる", "召し上がる", "めしあがる", "頂く", "いただく", "食う", "くう"]),
    items: [
      ["食べる", "たべる", "普通说法：吃。最中性，日常最常用。"],
      ["召し上がる", "めしあがる", "尊敬语：别人吃/喝。抬高对方。"],
      ["頂く", "いただく", "谦让语：我吃/喝；也可表示得到。降低自己。"],
      ["食う", "くう", "粗俗/男性化口语：吃。词库没有也给你作辨析参考。"]
    ]
  },
  {
    keys: new Set(["見る", "みる", "見える", "みえる", "見せる", "みせる"]),
    items: [
      ["見る", "みる", "主动看。"],
      ["見える", "みえる", "能看见/映入眼帘，偏自动。"],
      ["見せる", "みせる", "给别人看，偏他动。"]
    ]
  },
  {
    keys: new Set(["聞く", "きく", "聞こえる", "きこえる"]),
    items: [
      ["聞く", "きく", "主动听；也可表示询问。"],
      ["聞こえる", "きこえる", "听得见，声音自然传入耳中。"]
    ]
  }
];

/**
 * 计算编辑距离（Levenshtein Distance）
 */
export function editDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * 计算假名相似度（基于编辑距离）
 */
export function kanaSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  return Math.max(1 - editDistance(left, right) / Math.max(Array.from(left).length, Array.from(right).length, 1), 0);
}

/**
 * 计算结构相似度（考虑首尾字符和长度）
 */
export function structuralSimilarity(left: string, right: string): number {
  let score = kanaSimilarity(left, right);
  if (left && right && left[0] === right[0]) score += 0.08;
  if (left && right && left[left.length - 1] === right[right.length - 1]) score += 0.08;
  if (Array.from(left).length === Array.from(right).length) score += 0.06;
  return Math.min(score, 1);
}

/**
 * 根据假名长度确定相似度阈值
 */
export function confusionThreshold(kana: string): number {
  const length = Array.from(kana).length;
  if (length <= 2) return 0.9;
  if (length === 3) return 0.82;
  if (length === 4) return 0.74;
  return 0.68;
}

/**
 * 最大长度差异（用于过滤候选）
 */
export function maxConfusionLengthGap(kana: string): number {
  const length = Array.from(kana).length;
  if (length <= 3) return 1;
  if (length <= 5) return 2;
  return 3;
}

/**
 * 获取语义辨析组（如：食べる vs 召し上がる）
 */
export function senseDistinctions(row: DbRow): WordCard["confusions"] {
  const keys = new Set([String(row.kana ?? ""), String(row.kanji ?? "")]);
  const group = senseGroups.find((item) => Array.from(keys).some((key) => item.keys.has(key)));
  if (!group) return [];
  return group.items.flatMap(([kanji, kana, meaning]) => {
    if (kanji === row.kanji && kana === row.kana) return [];
    return [{ kanji, kana, meaning, kind: "sense" }];
  });
}

/**
 * 查找易混词候选
 */
export function confusionCandidates(row: DbRow): WordCard["confusions"] {
  const currentKana = String(row.kana ?? "");
  if (!currentKana) return senseDistinctions(row);
  const currentPos = String(row.pos ?? "").split("・")[0];
  const maxGap = maxConfusionLengthGap(currentKana);
  const threshold = confusionThreshold(currentKana);
  const scored = rowsFor(`
    SELECT id, meaning, kana, kanji, pos, verb_type, importance
    FROM words
    WHERE id != ?
      AND ABS(LENGTH(kana) - LENGTH(?)) <= ?
  `, [Number(row.id ?? 0), currentKana, maxGap]).flatMap((candidate) => {
    const candidateKana = String(candidate.kana ?? "");
    if (Math.abs(Array.from(currentKana).length - Array.from(candidateKana).length) > maxGap) return [];
    const phonetic = kanaSimilarity(currentKana, candidateKana);
    const structural = structuralSimilarity(currentKana, candidateKana);
    let similarity = phonetic * 0.65 + structural * 0.35;
    if (currentPos && String(candidate.pos ?? "").includes(currentPos)) similarity += 0.04;
    if (row.verb_type && row.verb_type === candidate.verb_type) similarity += 0.04;
    if (similarity < threshold) return [];
    return [{ similarity, candidate }];
  }).sort((left, right) => (
    right.similarity - left.similarity
    || Number(right.candidate.importance ?? 0) - Number(left.candidate.importance ?? 0)
  ));

  const phoneticItems = scored.slice(0, 3).map(({ candidate }) => ({
    kana: String(candidate.kana ?? ""),
    kanji: String(candidate.kanji ?? ""),
    meaning: String(candidate.meaning ?? ""),
    kind: "sound"
  }));
  const existing = new Set(phoneticItems.map((item) => `${item.kana}|${item.kanji}`));
  return [
    ...senseDistinctions(row).filter((item) => !existing.has(`${item.kana}|${item.kanji}`)),
    ...phoneticItems
  ];
}
