/**
 * 「时刻」=专门停下来说一句话的庆祝。
 *
 * 和「反馈」是两类东西,别混:
 *   反馈 —— 数字滚动、进度条滑动。只是把已经发生的变化画出来,不占预算,
 *           可以到处撒(见 hooks/useCountUp)。
 *   时刻 —— 打断你两秒告诉你一件事。必须限量:天天放礼花等于没放。
 *
 * 所以这里的每一个都要过三道闸:一次性标记、优先级、每日预算。
 */

/** 每加一种庆祝,在这里加一个种类;key 的粒度由各自的检测器决定 */
export type MomentKind = "plan_trend";

/**
 * 优先级刻度。预算不够时低的**直接丢掉**,不排队到明天 ——
 * 时刻的价值在于「此刻正好发生」,隔天再说就是假的。
 *
 *   80+   一辈子没几次:积压清零、拿下顽固词
 *   40~60 每周可能撞上一次:比昨天少 N 个、久别重逢
 *   ~20   常见:手速、词条纪念日
 */
export const MOMENT_PRIORITY = {
  planTrend: 45
} as const;

/** 一天最多播几个。稀有才有分量 —— 这个数字往上调之前先想清楚。 */
export const MOMENT_DAILY_BUDGET = 2;

export interface Moment {
  kind: MomentKind;
  /**
   * 一次性的粒度:同一个 (kind, key) 一辈子只播一次。
   * 每天一次 → 填日期;每词一次 → 填 word_id;一辈子一次 → 填固定串或阈值。
   */
  key: string;
  priority: number;
  /** 播报文案,已经是成句的话 */
  text: string;
  /** 停留多久(毫秒):够读完,又不至于杵在那儿要人去关 */
  holdMs: number;
}
