/**
 * 排片器:决定「下一张给哪个词」。
 *
 * 和优先级打分是两件事。priority.ts 回答的是「谁更该复习」,只看单张卡;
 * 这里回答的是「放在序列的这个位置合不合适」—— 要看会话进度、最近出过什么、
 * 刚刚连错了几次。这些约束没法塞进线性打分里,硬塞就是一堆互相打架的魔法数字。
 *
 * 三条硬约束(能满足就满足,满足不了就跳过该条,永远保证选得出一张):
 *  1. 干扰隔离:同混淆组的词不能在 INTERFERENCE_WINDOW 张之内挨着出;
 *  2. 开场减压:前几张不给顽固词和预测最难的那批;
 *  3. 连败保护:连着答错就避开预测最难的那批,打断「不认识→不认识→退出」。
 *
 * 最后在剩下的候选里按优先级**加权随机**,而不是取最大值 —— 取最大值会让
 * 「最过期的那批」连着糊脸,加权随机同样尊重优先级,但不会每天开头都是同一批。
 */

import { INTERFERENCE_WINDOW, type InterferenceIndex } from "./interference";

/** 开场减压覆盖前几张 */
export const OPENING_CARDS = 6;
/** 开场阶段排除掉预测答对概率低于此值的词 */
export const OPENING_MIN_RECALL = 0.35;
/** 连着答错这么多次触发连败保护 */
export const WRONG_STREAK_TRIGGER = 2;
/** 加权随机只在优先级前几名里抽 */
export const WEIGHTED_POOL_SIZE = 6;
/** 名次每往后一位,权重减半 */
export const WEIGHT_DECAY = 0.5;
/** 没有 FSRS 记录的词(新词/未调度)按中性偏易处理:它是「没学过」,不是「记不住」 */
export const UNKNOWN_RECALL = 0.7;

export interface SequencerCandidate {
  id: number;
  /** priority.ts 算出来的复习优先级 */
  score: number;
  /** 此刻预测答对的概率 ∈ [0,1] */
  recall: number;
  isLeech: boolean;
}

export interface SequencerContext {
  /** 今天已经答了多少张 = 会话位置 */
  answeredToday: number;
  /** 最近出过的词,新 → 旧 */
  recentIds: number[];
  /** 结尾连续答错(含模糊)的次数 */
  wrongStreak: number;
  interference: InterferenceIndex;
  random?: () => number;
}

/** 中位数,用来界定「预测最难的那批」 */
const medianRecall = (candidates: SequencerCandidate[]): number => {
  const sorted = candidates.map((item) => item.recall).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * 逐条应用软化的硬约束:过滤后为空就当这条没提,保证永远有候选。
 * 顺序即优先级——排在前面的约束更重要,后面的先被牺牲。
 */
const applyConstraints = (
  candidates: SequencerCandidate[],
  context: SequencerContext
): SequencerCandidate[] => {
  const keepNonEmpty = (next: SequencerCandidate[], current: SequencerCandidate[]) =>
    next.length ? next : current;

  let pool = candidates;

  // 1. 干扰隔离
  const window = context.recentIds.slice(0, INTERFERENCE_WINDOW);
  if (window.length) {
    pool = keepNonEmpty(
      pool.filter((item) => !window.some((recent) => context.interference.conflicts(item.id, recent))),
      pool
    );
  }

  // 2. 开场减压:打开 App 不该被顽固词和最难的词当头一棒
  if (context.answeredToday < OPENING_CARDS) {
    pool = keepNonEmpty(pool.filter((item) => !item.isLeech), pool);
    pool = keepNonEmpty(pool.filter((item) => item.recall >= OPENING_MIN_RECALL), pool);
  }

  // 3. 连败保护:避开预测最难的一半,不硬塞「高把握词」——硬塞会打乱到期顺序,
  //    而且用户看得出来系统在哄他。
  if (context.wrongStreak >= WRONG_STREAK_TRIGGER) {
    const threshold = medianRecall(pool);
    pool = keepNonEmpty(pool.filter((item) => item.recall >= threshold), pool);
  }

  return pool;
};

/** 在优先级前几名里按几何权重随机抽一个 */
const weightedPick = (
  candidates: SequencerCandidate[],
  random: () => number
): SequencerCandidate | null => {
  if (!candidates.length) return null;
  const ranked = [...candidates].sort((left, right) => right.score - left.score)
    .slice(0, WEIGHTED_POOL_SIZE);
  const weights = ranked.map((_, index) => WEIGHT_DECAY ** index);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < ranked.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return ranked[index];
  }
  return ranked[ranked.length - 1];
};

export function pickNextInSequence(
  candidates: SequencerCandidate[],
  context: SequencerContext
): SequencerCandidate | null {
  if (!candidates.length) return null;
  return weightedPick(applyConstraints(candidates, context), context.random ?? Math.random);
}
