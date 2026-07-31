import { getDailyWordGoal } from "../studyPreferences";
import { currentComeback } from "../comeback";
import { requeueGap } from "../scheduler/requeue";
import { getState, setState } from "../study-core";

/**
 * 一次学习会话里的「当下状态」——排队、刚答过的是哪张、今日新词配额。
 * 全部落在 DB 的 key-value 状态里,没有模块级变量,所以从 word-api 搬出来是纯搬家。
 * stage1 出题和提交答案都要用它,单独成模块避免两边互相 import 成环。
 */

export const dailyNewQuota = () => {
  // 回归模式期间暂停引入新词，先清积压
  if (currentComeback()) return 0;
  return getDailyWordGoal();
};

export const getReviewQueue = (): { word_id: number; due_after: number }[] => {
  try {
    const queue = JSON.parse(getState("review_queue", "[]"));
    if (!Array.isArray(queue)) return [];
    return queue.flatMap((item) => {
      const wordId = Number(item?.word_id);
      if (!Number.isFinite(wordId)) return [];
      return [{ word_id: wordId, due_after: Math.max(Number(item?.due_after ?? 0), 0) }];
    });
  } catch {
    return [];
  }
};

export const setReviewQueue = (queue: { word_id: number; due_after: number }[]) => {
  setState("review_queue", JSON.stringify(queue));
};

export const advanceReviewQueue = (answeredWordId: number) => {
  setReviewQueue(getReviewQueue().flatMap((item) => {
    if (item.word_id === answeredWordId) return [];
    return [{ word_id: item.word_id, due_after: Math.max(item.due_after - 1, 0) }];
  }));
};

export const scheduleDelayedReview = (wordId: number, minutesUntilDue = 0, immediate = false) => {
  const queue = getReviewQueue().filter((item) => item.word_id !== wordId);
  // 过几张卡后再出:张数按 FSRS 学习步骤的时长换算(1m 短步 / 10m 长步),随机化。
  // 见 requeue.ts——贴脸重复只是抄写,不是回忆。顽固词(连错好几次)例外:排 0,当场接着刷。
  queue.push({ word_id: wordId, due_after: immediate ? 0 : requeueGap(minutesUntilDue) });
  setReviewQueue(queue);
};

/** 刚答过的那张(默认下一张不是它,除非顽固词/收尾阶段——见 allowsBackToBack) */
export const setLastAnsweredWord = (wordId: number) => setState("last_answered_word", String(wordId));
export const lastAnsweredWord = (): number => Number(getState("last_answered_word", "0")) || 0;
