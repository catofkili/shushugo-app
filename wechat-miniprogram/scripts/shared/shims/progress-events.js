// lib/progress-events.ts：网页用 window 事件通知页面刷新；小程序页面在 onShow 里自己重读，这里只转发到 window 替身。
const PROGRESS_UPDATED_EVENT = 'shushugo-progress-updated';
module.exports = {
  PROGRESS_UPDATED_EVENT,
  notifyProgressUpdated: () => {
    try { globalThis.window.dispatchEvent(new globalThis.Event(PROGRESS_UPDATED_EVENT)); } catch { /* 没装 polyfill 时忽略 */ }
  }
};
