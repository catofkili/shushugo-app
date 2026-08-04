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
/** 长步(≈10 分钟):答对后的**第一次确认**,隔 10 个词左右 */
export const LONG_STEP_GAP: readonly [number, number] = [9, 14];
/** 超长步(≈30 分钟):问题词的**第二次确认**,再隔 20 个词左右 */
export const EXTRA_LONG_STEP_GAP: readonly [number, number] = [16, 26];
/**
 * 长期低分词的**毕业判定**那一次:隔 8~20 张。
 *
 * 中间步骤隔 3 张再问,答对的是工作记忆,这没关系 —— 中间答对也不毕业,
 * FSRS 不会据此拉长间隔。但「答对就当天出队」的那一次会真的改写长期间隔:
 * 那次如果是靠残留答对的,FSRS 就收到一个假的「记住了」,把复习排到几天后,
 * 然后必然再忘。所以只有这一次必须是干净的回忆测试。
 *
 * 只对长期低分词生效。新词走到最后一步也拉这么远的话,一场可能就走不完了。
 */
export const GRADUATION_TEST_GAP: readonly [number, number] = [8, 20];
/** 分界:下次到期超过这么多分钟算长步 */
export const LONG_STEP_MINUTES = 5;
/** 分界:超过这么多分钟算超长步 */
export const EXTRA_LONG_STEP_MINUTES = 20;

/**
 * 把「下次到期还有多少分钟」换算成「隔几张卡再出」。
 * 张数只是排队位置,当天剩余卡片不够时由取词端退化成轮转(见 pickStage1Next)——
 * 排不下就尽量靠近,当天的账当天平掉,不留到明天。
 */
export const requeueGap = (
  minutesUntilDue: number,
  randomBetween = defaultRandomBetween,
  isGraduationTest = false
): number => {
  const stepGap =
    minutesUntilDue >= EXTRA_LONG_STEP_MINUTES
      ? EXTRA_LONG_STEP_GAP
      : minutesUntilDue >= LONG_STEP_MINUTES
        ? LONG_STEP_GAP
        : SHORT_STEP_GAP;
  // 毕业判定取两者的并集:超长步本来就排得更远,不该被这条拉回来
  const [min, max] = isGraduationTest
    ? [Math.max(stepGap[0], GRADUATION_TEST_GAP[0]), Math.max(stepGap[1], GRADUATION_TEST_GAP[1])]
    : stepGap;
  return randomBetween(min, max);
};

/** 连着错(含模糊)这么多次 = 顽固词:该盯着刷,允许连出。答对即清零,自动退出连出 */
export const STUBBORN_MISTAKE_STREAK = 3;
/** 当天任务剩这个比例以内 = 收尾阶段:池子太小,轮转已经没意义,允许连出 */
export const ENDGAME_REMAINING_RATIO = 0.1;

/**
 * 是否允许「刚答过的词接着再出」。
 *
 * 默认不允许,但两种情况例外:
 *  - 顽固词:连着错好几次了,越出越密才攻得下来 —— 这是有意的,别改成「隔开」;
 *  - 收尾阶段:当天只剩最后十分之一,可选的词本来就没几个,硬要隔开等于空转。
 *
 * 注意 mistakeStreak 在答对时归零,所以贴脸重复只发生在**连着答错**的阶段;
 * 一旦答对,下一次必然被拉开(见 requeueGap 的档位),不会出现「答对了还贴脸」。
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
