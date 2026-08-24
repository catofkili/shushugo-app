/**
 * 易混词识别算法
 */

import { WordCard } from "../../types/vocabulary";
import { DbRow, rowsFor } from "../database/db-utils";
import { duplicateWordIds } from "../confusion-groups";
import { worthComparing } from "./familiarity";

/**
 * 计算编辑距离（Levenshtein Distance）
 */
export function editDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  // 只滚动两行:原来每次比较都要 new 出一个 (m+1)×(n+1) 的二维数组,
  // 而这个函数在一张卡里要跑几千次,分配开销比计算本身还大。
  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
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
 * 每个词的易混词结果缓存。
 *
 * 这个函数每张卡都要跑一次,而它内部是「按假名长度筛一遍 words 表(几千行)
 * 再逐个算编辑距离」—— 实测 16ms/次,占整张卡耗时的三成。词库在一次会话里
 * 基本不变,算过一次就存下来;导入词单后由 resetConfusionCache 清掉。
 */
const confusionCache = new Map<number, WordCard["confusions"]>();

export const resetConfusionCache = (): void => {
  confusionCache.clear();
  wordsByKanaLength = null;
};

/**
 * 查找易混词候选
 */
export function confusionCandidates(row: DbRow): WordCard["confusions"] {
  const cacheKey = Number(row.id ?? 0);
  if (cacheKey) {
    const cached = confusionCache.get(cacheKey);
    if (cached) return cached;
  }
  const computed = computeConfusionCandidates(row);
  if (cacheKey) confusionCache.set(cacheKey, computed);
  return computed;
}

/**
 * 词表的内存副本,按假名字数分桶。
 *
 * 原来每张卡都发一条 `SELECT ... FROM words WHERE ABS(LENGTH(kana)-...)`,
 * 每次要把几千行从 WASM 里搬出来 —— 实测 15ms/张,是整张卡耗时里最大的一块。
 * 编辑距离本身只要 1~2ms,贵的是那趟 SQL。词库在会话内不变,读一次留着用。
 * 判定逻辑一个字没改,结果与原来完全一致。
 */
interface ConfusionWord {
  id: number;
  meaning: string;
  kana: string;
  kanji: string;
  pos: string;
  verbType: unknown;
  importance: number;
  jlptLevel: string;
  length: number;
}

let wordsByKanaLength: Map<number, ConfusionWord[]> | null = null;

const loadWords = (): Map<number, ConfusionWord[]> => {
  if (wordsByKanaLength) return wordsByKanaLength;
  const buckets = new Map<number, ConfusionWord[]>();
  for (const candidate of rowsFor("SELECT id, meaning, kana, kanji, pos, verb_type, importance, jlpt_level FROM words")) {
    const kana = String(candidate.kana ?? "");
    if (!kana) continue;
    const length = Array.from(kana).length;
    const entry: ConfusionWord = {
      id: Number(candidate.id ?? 0),
      meaning: String(candidate.meaning ?? ""),
      kana,
      kanji: String(candidate.kanji ?? ""),
      pos: String(candidate.pos ?? ""),
      verbType: candidate.verb_type,
      importance: Number(candidate.importance ?? 0),
      jlptLevel: String(candidate.jlpt_level ?? ""),
      length
    };
    const bucket = buckets.get(length);
    if (bucket) bucket.push(entry);
    else buckets.set(length, [entry]);
  }
  wordsByKanaLength = buckets;
  return buckets;
};

function computeConfusionCandidates(row: DbRow): WordCard["confusions"] {
  const currentKana = String(row.kana ?? "");
  if (!currentKana) return [];
  const currentPos = String(row.pos ?? "").split("・")[0];
  const currentId = Number(row.id ?? 0);
  const currentLength = Array.from(currentKana).length;
  const maxGap = maxConfusionLengthGap(currentKana);
  const threshold = confusionThreshold(currentKana);

  const buckets = loadWords();
  // 老库里同一个词有两行(コピー / copy / コピー)。不滤掉的话音近榜上会同时出现
  // 同一个词的两行,而且它们互相之间相似度满分,排名还都很靠前。
  const duplicates = duplicateWordIds();
  const nearby: ConfusionWord[] = [];
  for (let length = currentLength - maxGap; length <= currentLength + maxGap; length += 1) {
    const bucket = buckets.get(length);
    if (bucket) nearby.push(...bucket);
  }

  const currentLevel = String(row.jlpt_level ?? "");
  const scored = nearby.flatMap((candidate) => {
    if (candidate.id === currentId || duplicates.has(candidate.id)) return [];
    // 筛在取前三**之前**：放到后面筛等于让没学过的生僻词先把位置占掉再被删空
    if (!worthComparing(currentLevel, candidate.jlptLevel, candidate.id)) return [];
    const candidateKana = candidate.kana;
    // 假名一模一样的不是「音形相近」——「形」根本没差。这一条挡掉的三样东西都不该
    // 挂在音近名下:老库里没合并的外来語重复行(インターネット / internet,272 对)、
    // 纯异写(繋がる / つながる,120 对)、以及真的同音异义词(公園 / 講演,2256 对)。
    // 前两样根本不是易混词,最后一样有更准的说法 —— confusion-groups 的 homophone /
    // kanji-choice 组会把它们收进去,并告诉用户「读音完全一样,只能靠语境选汉字」。
    // 编辑距离对这三样一视同仁地给满分 1.0,于是它们永远霸占前三名,把真正差一两个
    // 假名的候选挤没了。
    if (candidateKana === currentKana) return [];
    const phonetic = kanaSimilarity(currentKana, candidateKana);
    const structural = structuralSimilarity(currentKana, candidateKana);
    let similarity = phonetic * 0.65 + structural * 0.35;
    if (currentPos && candidate.pos.includes(currentPos)) similarity += 0.04;
    if (row.verb_type && row.verb_type === candidate.verbType) similarity += 0.04;
    if (similarity < threshold) return [];
    return [{ similarity, candidate }];
  }).sort((left, right) => (
    right.similarity - left.similarity
    || right.candidate.importance - left.candidate.importance
  ));

  const phoneticItems = scored.slice(0, 3).map(({ candidate }) => ({
    id: candidate.id,
    kana: candidate.kana,
    kanji: candidate.kanji,
    meaning: candidate.meaning,
    kind: "sound"
  }));
  return phoneticItems;
}
