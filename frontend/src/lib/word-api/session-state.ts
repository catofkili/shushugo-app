import { getDailyWordGoal } from "../studyPreferences";
import { requeueGap } from "../scheduler/requeue";
import { firstValue, getState, rowsFor, setState } from "../study-core";

/**
 * 一次学习会话里的「当下状态」——排队、刚答过的是哪张、今日新词配额。
 * 全部落在 DB 的 key-value 状态里,没有模块级变量,所以从 word-api 搬出来是纯搬家。
 * stage1 出题和提交答案都要用它,单独成模块避免两边互相 import 成环。
 */

export const dailyNewQuota = () => getDailyWordGoal();

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

export const scheduleDelayedReview = (
  wordId: number,
  minutesUntilDue = 0,
  immediate = false,
  isGraduationTest = false
) => {
  const queue = getReviewQueue().filter((item) => item.word_id !== wordId);
  // 过几张卡后再出:张数按 FSRS 学习步骤的时长换算(1m 短步 / 10m 长步),随机化。
  // 见 requeue.ts——贴脸重复只是抄写,不是回忆。顽固词(连错好几次)例外:排 0,当场接着刷。
  // 长期低分词的毕业判定那一次拉到 8~20 张,那一次必须是真的回忆测试。
  queue.push({
    word_id: wordId,
    due_after: immediate ? 0 : requeueGap(minutesUntilDue, undefined, isGraduationTest)
  });
  setReviewQueue(queue);
};

/** 刚答过的那张(默认下一张不是它,除非顽固词/收尾阶段——见 allowsBackToBack) */
export const setLastAnsweredWord = (wordId: number) => setState("last_answered_word", String(wordId));
export const lastAnsweredWord = (): number => Number(getState("last_answered_word", "0")) || 0;

export interface RecentAnswers {
  /** 今天已经答了多少张 = 会话位置 */
  answeredToday: number;
  /** 最近出过的词,新 → 旧(可能重复) */
  wordIds: number[];
  /** 结尾连续答错(含模糊)的次数 */
  wrongStreak: number;
}

/**
 * 排片器需要的「最近发生了什么」。直接从 reviews 读,不另存会话状态 ——
 * 少一个键就少一份要跟着同步、跟着过期的东西。
 *
 * 按 created_at 排序而不是 id:跨设备合并后本机 id 是重新分配的,不再单调。
 */
export function recentAnswersToday(day: string, limit: number): RecentAnswers {
  const answeredToday = firstValue<number>(
    "SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?",
    [day],
    0
  );
  const rows = rowsFor(
    `SELECT word_id, answer FROM reviews
     WHERE reviewed_on = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [day, Math.max(limit, 1)]
  );
  // 连败按「不同的词」算。同一个词被顽固词机制反复刷,那是钻研不是连败 ——
  // 按次数算的话每次钻研都会触发保护,正好把钻研机制废掉。
  const wrongWords = new Set<number>();
  for (const row of rows) {
    const answer = String(row.answer ?? "");
    if (answer !== "forgot" && answer !== "fuzzy") break;
    wrongWords.add(Number(row.word_id));
  }
  const wrongStreak = wrongWords.size;
  return {
    answeredToday,
    wordIds: rows.map((row) => Number(row.word_id)),
    wrongStreak
  };
}
