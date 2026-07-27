/**
 * 短期重刷的「隔几张再出」
 *
 * FSRS 学习步骤给的是时间(1m / 10m),但端上的队列是按「过几张卡」计数的。
 * 如果换算得太短,就变成「刚看完答案立刻考同一个词」——答对只是把答案从工作记忆里
 * 搬一遍(等于抄写),并不代表记住了。所以按步骤时长换算成张数,并且随机化,
 * 避免固定节奏被预期(用户数着张数就知道下一张是谁)。
 */

const defaultRandomBetween = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1));

/** 短步(≈1 分钟,答错退回第一步):隔开就行,别拖太远——当天还要刷回来的 */
export const SHORT_STEP_GAP: readonly [number, number] = [3, 8];
/** 长步(≈10 分钟,学习步骤进阶):放得远一些,真要从长期记忆里捞一次 */
export const LONG_STEP_GAP: readonly [number, number] = [9, 18];
/** 分界:下次到期超过这么多分钟算长步 */
export const LONG_STEP_MINUTES = 5;

/**
 * 把「下次到期还有多少分钟」换算成「隔几张卡再出」。
 * 张数只是排队位置,当天剩余卡片不够时由取词端退化成轮转(见 pickStage1Next)。
 */
export const requeueGap = (
  minutesUntilDue: number,
  randomBetween = defaultRandomBetween
): number => {
  const [min, max] = minutesUntilDue >= LONG_STEP_MINUTES ? LONG_STEP_GAP : SHORT_STEP_GAP;
  return randomBetween(min, max);
};

/** 连着错(含模糊)这么多次 = 顽固词:该盯着刷,允许连出 */
export const STUBBORN_MISTAKE_STREAK = 3;
/** 当天任务剩这个比例以内 = 收尾阶段:池子太小,轮转已经没意义,允许连出 */
export const ENDGAME_REMAINING_RATIO = 0.1;

/**
 * 是否允许「刚答过的词接着再出」。
 *
 * 默认不允许(贴脸重复只是抄写),但两种情况例外:
 *  - 顽固词:连着错好几次了,隔开反而是放它跑,不如当场刷到会;
 *  - 收尾阶段:当天只剩最后十分之一,可选的词本来就没几个,硬要隔开等于空转。
 */
export const allowsBackToBack = (opts: {
  mistakeStreak: number;
  remaining: number;
  total: number;
}): boolean => {
  if (opts.mistakeStreak >= STUBBORN_MISTAKE_STREAK) return true;
  if (opts.total <= 0) return false;
  return opts.remaining <= Math.ceil(opts.total * ENDGAME_REMAINING_RATIO);
};
