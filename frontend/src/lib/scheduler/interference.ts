/**
 * 相互干扰的词(混淆组)。
 *
 * いらっしゃる 刚出过,十张之内再出 おいでになる —— 用户答对的是上一张的残留,
 * 不是这个词本身的记忆。**这不是体验问题,是数据污染**:FSRS 收到一个假的
 * 「记住了」,就会把这个词的间隔往后推,之后一直排错。所以同组词必须隔开。
 *
 * 干扰来源有三类,合并成一张邻接表:
 *  1. 自他动词对(verb_pair_hints,368 对)—— ぶつかる / ぶつける
 *  2. 中文释义相近组(similar_meaning_groups,38 组)—— いらっしゃる / おいでになる
 *  3. 音形相近(confusion.ts 的编辑距离口径)—— ずらす / ずれる
 *
 * 第 3 类全词库有 47726 对、覆盖 73% 的词条,**绝不能每张卡现算一次全表**。
 * 这里只在「当天候选集」内部算(几百个词),并按当天的任务集合记忆化。
 */

import verbPairHints from "../../data/verb_pair_hints.json";
import { similarMeaningGroups } from "../../data/similar_meaning_groups";
import {
  confusionThreshold,
  kanaSimilarity,
  maxConfusionLengthGap,
  structuralSimilarity
} from "../models/confusion";
import type { DbRow } from "../database/db-utils";

/** 同一混淆组至少隔开这么多张 */
export const INTERFERENCE_WINDOW = 12;

type VerbPairTable = Record<string, [string, string, string, string]>;
const verbPairs = verbPairHints as unknown as VerbPairTable;

export interface InterferenceIndex {
  /** 两个词是否互相干扰 */
  conflicts: (left: number, right: number) => boolean;
  /** 这个词是否在索引里(不在说明索引已过期,需要重建) */
  has: (id: number) => boolean;
}

export const EMPTY_INTERFERENCE: InterferenceIndex = {
  conflicts: () => false,
  has: () => true
};

/** 一个词所属的「静态组」标记:同标记即互相干扰,不用两两比对 */
const staticTokensOf = (row: DbRow): string[] => {
  const kanji = String(row.kanji ?? "");
  const kana = String(row.kana ?? "");
  const tokens: string[] = [];

  for (const key of [kanji, kana]) {
    const pair = key && verbPairs[key];
    if (!pair) continue;
    const partner = String(pair[1] ?? "");
    if (!partner) continue;
    // 自他动词是「一对」,两边算出来的标记必须一致 —— 排序后拼接
    tokens.push(`vp:${[key, partner].sort().join("|")}`);
  }

  const group = similarMeaningGroups.find((candidate) => candidate.members.some(
    ([memberKanji, memberKana]) => (
      (memberKanji === kanji && memberKana === kana)
      || memberKanji === kana
      || memberKana === kana
    )
  ));
  if (group) tokens.push(`sm:${group.id}`);

  return tokens;
};

/** 音形是否相近:口径与卡片上展示的易混词一致(confusion.ts) */
const soundsAlike = (left: DbRow, right: DbRow): boolean => {
  const leftKana = String(left.kana ?? "");
  const rightKana = String(right.kana ?? "");
  if (!leftKana || !rightKana) return false;
  const gap = Math.abs(Array.from(leftKana).length - Array.from(rightKana).length);
  if (gap > maxConfusionLengthGap(leftKana)) return false;

  let similarity = kanaSimilarity(leftKana, rightKana) * 0.65
    + structuralSimilarity(leftKana, rightKana) * 0.35;
  const leftPos = String(left.pos ?? "").split("・")[0];
  if (leftPos && String(right.pos ?? "").includes(leftPos)) similarity += 0.04;
  if (left.verb_type && left.verb_type === right.verb_type) similarity += 0.04;
  return similarity >= confusionThreshold(leftKana);
};

/**
 * 为一批候选词建立干扰邻接表。O(n²) 的音近比对只发生在这里,
 * 调用方要按当天的任务集合缓存住(见 sessionInterference)。
 */
export function buildInterferenceIndex(rows: DbRow[]): InterferenceIndex {
  const ids = rows.map((row) => Number(row.id ?? row.word_id ?? 0));
  const adjacency = new Map<number, Set<number>>();
  const link = (left: number, right: number) => {
    if (left === right) return;
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    if (!adjacency.has(right)) adjacency.set(right, new Set());
    adjacency.get(left)!.add(right);
    adjacency.get(right)!.add(left);
  };

  const byToken = new Map<string, number[]>();
  rows.forEach((row, index) => {
    for (const token of staticTokensOf(row)) {
      const bucket = byToken.get(token) ?? [];
      bucket.push(ids[index]);
      byToken.set(token, bucket);
    }
  });
  for (const bucket of byToken.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) link(bucket[i], bucket[j]);
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (soundsAlike(rows[i], rows[j])) link(ids[i], ids[j]);
    }
  }

  const present = new Set(ids);
  return {
    conflicts: (left, right) => adjacency.get(left)?.has(right) ?? false,
    has: (id) => present.has(id)
  };
}

/**
 * 当天候选集的干扰表缓存。候选集随着词毕业而缩小(子集直接复用),
 * 一旦出现索引里没有的词(续杯加了新任务)就整体重建。
 */
let cached: { index: InterferenceIndex; day: string } | null = null;

export function sessionInterference(day: string, rows: DbRow[]): InterferenceIndex {
  const ids = rows.map((row) => Number(row.id ?? row.word_id ?? 0));
  if (cached?.day === day && ids.every((id) => cached!.index.has(id))) {
    return cached.index;
  }
  cached = { index: buildInterferenceIndex(rows), day };
  return cached.index;
}

/** 测试用:清掉缓存 */
export const resetInterferenceCache = () => { cached = null; };
