/**
 * 单词推送优先级算法
 */

import { DbRow, daysSince } from "../database/db-utils";
import { LEECH_LAPSE_THRESHOLD } from "../fsrs-scheduler";

/**
 * 「有多陌生」换算成优先级分:stability 越低分越高,按对数铺开,到 FAMILIAR_DAYS 归零。
 *
 * 2026-09-17 之前这一项是「过期天数 × 6」(Anki 默认的 due date 顺序,2026-08-04 删自研
 * 分数时顺手抄的)。它成立的前提是每天清完队列;清不完的话陈年尾巴永远排最前,
 * 而昨天刚学、stability 不到一天的词永远垫底 —— 实测昨天的新词 100% 落在当天最后 1/4,
 * 末段答错率 40% vs 前面 30%。用户原话:「欠得久的都是老朋友怎么都有印象,真正陌生的
 * 是这几天新学的」。过期 14 天的卡再拖 8 小时不会更忘,stability 0.3 天的会。
 */
const UNFAMILIAR_CAP = 50;
const FAMILIAR_DAYS = 30;
/**
 * 随机抖动的幅度。原来是 8,对着 0–50 的陌生度等于按分死排,一天的顺序几乎是确定的。
 * 用户要的是「整体偏陌生的先出,但局部乱序」:60 分的均匀抖动下,差 21 分(昨天新学 vs
 * 14 天没见的老朋友)仍有约 76% 排在前面,差 6 分的两张卡接近对半 —— 规则还在,序列不再可预测。
 */
const JITTER = 60;
/** 学习/重学中的词:当天必须刷到毕业,排在「已见但从未调度」之上 */
const RELEARNING_PRIORITY = 55;
/** 已见过但还没进入 FSRS 调度(或缺 stability 的旧四列数据)的词 */
const UNSCHEDULED_PRIORITY = 50;
/** 顽固词的加成:够它不沉底,远不足以让它插队 */
const LEECH_PRIORITY = 12;
/** 错误史的加成上限:它是次级信号,不该压过「有多陌生」(上限 50) */
const MISTAKE_CAP = 40;

/** stability(天)→ 陌生度分,∈ [0, UNFAMILIAR_CAP] */
const unfamiliarity = (stability: number): number =>
  UNFAMILIAR_CAP * Math.max(0, 1 - Math.log2(1 + Math.max(stability, 0)) / Math.log2(1 + FAMILIAR_DAYS));

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
  const components: Record<string, number> = {
    // 「有多该复习」= 有多陌生(FSRS stability),不是欠了多久
    score: 0,
    critical: 0,
    importance: Number(row.importance ?? 3) * 7,
    // 错误史统一用 FSRS 的 lapses,不再叠加 forgot/fuzzy/mistake_streak 三个旧计数。
    // 必须封顶:不封的话错了 20 次的词拿 200 分,把陌生度(上限 50)整个压死 ——
    // 「顽固词不再置顶」就成了空话,只是把置顶从 critical 挪到了这一项。
    mistake: Math.min(lapses * 10, MISTAKE_CAP),
    queue: 0,
    age: Math.min(daysSince(row.last_seen_on) * 3, 30),
    review: isNew ? 0 : 35,
    new: 0,
    // 快速模式传 randomize:false:它是「按优先级浏览」的批次,不能让随机数把低优先级词顶到最上面。
    jitter: options.randomize === false ? 0 : Math.random() * JITTER
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
      : row.fsrs_due == null || row.fsrs_stability == null
        ? UNSCHEDULED_PRIORITY
        : unfamiliarity(Number(row.fsrs_stability));
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
