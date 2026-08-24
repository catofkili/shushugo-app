/**
 * 学习时长的记账规则：**没在操作就不算学习**。
 *
 * 原来只挡「页面不可见」（document.visibilityState），可见但人已经走开的那段照收，
 * 于是同一份账本两头都不准：2026-08-21 记了 547 分钟（795 次作答 ≈ 1.5 次/分钟，
 * 显然是挂在那儿），而 08-16 只记了 91 分钟（按相邻作答间隔算至少 138 分钟）。
 *
 * 判据用「距上次交互多久」而不是「这张卡停留多久」：看例句、开辨析气泡、写便签
 * 都是真学习，而且都带着滚动和点击；走神是**一个事件都没有**。
 *
 * 阈值 60 秒是从用户自己的作答间隔定的：p50=8 秒、p75=20 秒、p90=51 秒、p95=94 秒，
 * 而这还是**整张卡**的时间（翻面 + 评分至少两次交互），两次交互之间比它更短。
 * 所以 60 秒已经在 p90 之上，几乎不会误伤「盯着题面想一会儿」；再低（45 秒以下）
 * 就开始吃到正常的思考时间了。
 *
 * 零头必须留着（`pendingMs`）：滚动事件每秒能来几十个，每次结账都 `Math.floor`
 * 取秒的话，每笔都是 0 秒，一场学习能记成 0 分钟。
 */

/** 距上次交互超过这个时间，之后的都不算学习时长 */
export const STUDY_IDLE_LIMIT_MS = 60_000;

export interface StudyClockState {
  /** 已经结算到哪一刻 */
  lastTickMs: number;
  /** 最后一次真实交互（点击 / 按键 / 滚动 / 触摸），不含鼠标移动 */
  lastInteractionMs: number;
  /** 不足一秒的零头，攒着等下次一起结 */
  pendingMs: number;
}

export const createStudyClock = (nowMs: number): StudyClockState => ({
  lastTickMs: nowMs,
  lastInteractionMs: nowMs,
  pendingMs: 0
});

/**
 * 把 `lastTickMs` 推进到 `nowMs`，其间**有效的**那部分记进 `pendingMs`。
 *
 * 有效区间在 `lastInteractionMs + idleLimitMs` 处截断：走神那段直接丢掉，
 * 不是顺延，所以回来之后不会补记。页面不可见时一秒都不记。
 */
export const accrueStudyTime = (
  state: StudyClockState,
  nowMs: number,
  options: { visible: boolean; idleLimitMs?: number }
): StudyClockState => {
  const idleLimitMs = options.idleLimitMs ?? STUDY_IDLE_LIMIT_MS;
  if (!options.visible) return { ...state, lastTickMs: nowMs };
  const activeUntil = state.lastInteractionMs + idleLimitMs;
  const countedUntil = Math.min(nowMs, activeUntil);
  const gained = Math.max(countedUntil - state.lastTickMs, 0);
  return { ...state, lastTickMs: nowMs, pendingMs: state.pendingMs + gained };
};

/**
 * 记一次交互。**必须先结上一段的账再改 `lastInteractionMs`**：
 * 否则走神 5 分钟之后点一下，那 5 分钟会因为「最后交互时间变成现在」而被追认。
 */
export const noteStudyInteraction = (
  state: StudyClockState,
  nowMs: number,
  options: { visible: boolean; idleLimitMs?: number }
): StudyClockState => ({
  ...accrueStudyTime(state, nowMs, options),
  lastInteractionMs: nowMs
});

/** 取出攒够的整秒去落账，零头留在 state 里 */
export const drainStudySeconds = (state: StudyClockState): { seconds: number; state: StudyClockState } => {
  const seconds = Math.floor(state.pendingMs / 1000);
  if (seconds <= 0) return { seconds: 0, state };
  return { seconds, state: { ...state, pendingMs: state.pendingMs - seconds * 1000 } };
};
