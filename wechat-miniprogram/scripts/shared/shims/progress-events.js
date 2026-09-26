// lib/progress-events.ts：网页用 window 事件通知页面刷新；小程序页面在 onShow 里自己重读，这里只转发到 window 替身。
// ⚠️ Taro 版不用这份（taro-spike-2/config/index.js 里删掉了这条替换），只有原生小程序在用。
const PROGRESS_UPDATED_EVENT = 'shushugo-progress-updated';
let muted = 0;
module.exports = {
  PROGRESS_UPDATED_EVENT,
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
