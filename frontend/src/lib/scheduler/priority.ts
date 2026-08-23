/**
 * 单词推送优先级算法
 */

import { DbRow, daysSince } from "../database/db-utils";
import { LEECH_LAPSE_THRESHOLD } from "../fsrs-scheduler";

/** 过期天数换算成优先级分的系数(封顶,避免陈年老账压过一切) */
const OVERDUE_WEIGHT = 6;
const OVERDUE_CAP = 60;
/** 学习/重学中的词:当天必须刷到毕业,排在「已见但从未调度」之上 */
const RELEARNING_PRIORITY = 55;
/** 已见过但还没进入 FSRS 调度的词 */
const UNSCHEDULED_PRIORITY = 50;
/** 顽固词的加成:够它不沉底,远不足以让它插队 */
const LEECH_PRIORITY = 12;
/** 错误史的加成上限:它是次级信号,不该压过「有多过期」(上限 60) */
const MISTAKE_CAP = 40;

/** 距今过期了多少天(未到期为 0) */
const overdueDays = (due: unknown, now: number): number => {
  if (due == null) return 0;
  const t = new Date(String(due)).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max((now - t) / 86_400_000, 0);
};

/**
 * 新词最少要占多大比例 —— 每 8 张里至少一张。
 *
 * 只按「剩余新词 / 剩余总量」穿插的话，**复习积压会把新词饿死**：实测用户当天
 * 复习任务 232～688 条、新词配额 15，比例只有 3%，于是一天答四五百张也只碰得到
 * 三个新词（2026-08-10 ~ 08-13、08-18 ~ 08-22 全是每天 3 个），配额那 15 个
 * 天天剩十二个没见过。而配额的意思是「今天要学这么多新词」，不是「新词占计划的
 * 百分之几」—— 积压是复习的事，不该由新词买单。
 *
 * 8 张一个的节奏：30 个新词大约 240 张出完，正好在用户一天的作答量之内。
 */
const NEW_WORD_MIN_SHARE = 1 / 8;

/**
 * 新词按当天尚未完成的比例随机穿插进旧词中（不低于 NEW_WORD_MIN_SHARE）。
 * 首张永远是旧词；临界旧词仍由调用方优先处理，避免随机新词抢占需要立即复习的内容。
 */
export const shouldPickStage1NewWord = (
  remainingReviewCount: number,
  remainingNewCount: number,
  completedTaskCount: number,
  randomValue = Math.random()
): boolean => {
  if (remainingNewCount <= 0) return false;
  if (remainingReviewCount <= 0) return true;
  if (completedTaskCount === 0) return false;
  const share = remainingNewCount / (remainingReviewCount + remainingNewCount);
  return randomValue < Math.max(share, NEW_WORD_MIN_SHARE);
};

/**
 * 计算优先级组件
 */
export function priorityComponents(
  row: DbRow,
  dueAfter: number | undefined,
  newQuotaLeft: number,
  options: { randomize?: boolean } = {}
): Record<string, number> {
  const isNew = Number(row.seen_count ?? 0) === 0;
  const lapses = Number(row.fsrs_lapses ?? 0);
  const now = Date.now();
  const components: Record<string, number> = {
    // 「有多该复习」不再看 score,而看 FSRS 排的 due 过期了多久
    score: 0,
    critical: 0,
    importance: Number(row.importance ?? 3) * 7,
    // 错误史统一用 FSRS 的 lapses,不再叠加 forgot/fuzzy/mistake_streak 三个旧计数。
    // 必须封顶:不封的话错了 20 次的词拿 200 分,把过期程度(上限 60)整个压死 ——
    // 「顽固词不再置顶」就成了空话,只是把置顶从 critical 挪到了这一项。
    mistake: Math.min(lapses * 10, MISTAKE_CAP),
    queue: 0,
    age: Math.min(daysSince(row.last_seen_on) * 3, 30),
    review: isNew ? 0 : 35,
    new: 0,
    // 普通学习用轻微抖动避免每天撞同一序列；快速模式传 randomize:false，
    // 因为它是“按优先级浏览”的批次，不能让随机数把低优先级词顶到最上面。
    jitter: options.randomize === false ? 0 : Math.random() * 8
  };

  if (isNew) {
    components.new = 45 + Math.min(newQuotaLeft, 10);
    components.score = 18;
    components.shuffle = Number(row.shuffle_rank ?? 0) * 18;
    components.importance = Number(row.importance ?? 3) * 4;
  } else {
    // 学习/重学中(FSRS state 1/3)= 今天答错过、必须当天刷到毕业。
    // 它的 due 被排在几分钟后、不算「过期」,若只看过期天数会拿 0 分,
    // 被一堆 fsrs_due 为空的词压死 —— 表现为「点了不认识,这个词再也不回来了」。
    // 所以给它一个高于「未调度」的固定档位,具体什么时候回来仍由 queue 组件(隔几张)控制。
    const state = Number(row.fsrs_state ?? 0);
    const inLearning = state === 1 || state === 3;
    components.score = inLearning
      ? RELEARNING_PRIORITY
      : row.fsrs_due == null
        ? UNSCHEDULED_PRIORITY
        : Math.min(overdueDays(row.fsrs_due, now) * OVERDUE_WEIGHT, OVERDUE_CAP);
  }

  // 顽固词(leech,累计答错 >= 8 次)**不再置顶**。
  //
  // 原来是 `120 + (顽固词数 - 3) * 80` —— 顽固词越多加得越狠,结果就是几十个
  // 攻不下来的词统治整场。而且方向本身就错了:一个失败了八次的词是「卡片坏了」,
  // 不是「复习不够」,继续加密只会把整场变成受刑。Anki 的处理是直接挂起它。
  //
  // 现在:顽固词按正常的过期程度排队,当天引入多少由 stage1 的配额闸门控制,
  // 集中攻坚交给错题本模式。这里只留一点点加成,保证它不会沉底到永远轮不到。
  if (lapses >= LEECH_LAPSE_THRESHOLD) {
    components.critical = LEECH_PRIORITY;
  }

  if (dueAfter !== undefined) {
    if (dueAfter <= 0) {
      components.queue = 45;
    } else {
      components.queue = -80 - dueAfter * 25;
    }
  }

  return components;
}

/**
 * 计算总优先级分数
 */
export function priorityScore(components: Record<string, number>): number {
  return Object.values(components).reduce((total, value) => total + value, 0);
}
