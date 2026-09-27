// lib/progress-events.ts：网页用 window 事件通知页面刷新；小程序页面在 onShow 里自己重读，这里只转发到 window 替身。
// ⚠️ Taro 版不用这份（taro-spike-2/config/index.js 里删掉了这条替换），只有原生小程序在用。
const PROGRESS_UPDATED_EVENT = 'shushugo-progress-updated';
const TODAY_WORD_PLAN_UPDATED_EVENT = 'shushugo-today-word-plan-updated';
let muted = 0;
let latestTodayWordAudioPlan = [];
module.exports = {
  PROGRESS_UPDATED_EVENT,
  TODAY_WORD_PLAN_UPDATED_EVENT,
  readTodayWordAudioPlanUpdate: () => latestTodayWordAudioPlan,
  // 共享 word-api 会调用此导出；Taro 用网页原版事件模块，不走这里。
  notifyTodayWordPlanUpdated: (plan) => {
    latestTodayWordAudioPlan = plan;
    try { globalThis.window.dispatchEvent(new globalThis.Event(TODAY_WORD_PLAN_UPDATED_EVENT)); } catch { /* 没装 polyfill 时忽略 */ }
  },
  // 和网页同名同义：预算下一张时库是马上要回滚的假状态，不派发
  withProgressEventsMuted: (run) => {
    muted += 1;
    try { return run(); } finally { muted -= 1; }
  },
  notifyProgressUpdated: () => {
    if (muted) return;
    try { globalThis.window.dispatchEvent(new globalThis.Event(PROGRESS_UPDATED_EVENT)); } catch { /* 没装 polyfill 时忽略 */ }
  }
};
