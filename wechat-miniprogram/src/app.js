const content = require('./shared/content');

App({
  globalData: {
    databaseReady: false
  },

  /*
   * 出厂内容（题面层、辨析审校、汉字读音 / 单元索引、音高重音）都在分包里，
   * 由 require.async 拉。这里**在启动时就开始拉**：网页那份代码第一次出题时会自己
   * 去 import 这些表，而它把那个 promise 缓存在 `loading ??=` 里 —— 失败一次就永久失败。
   * 页面侧的顺序保证在 database-store.ensureContentLoaded（每个页面都先 await 它拿库）。
   */
  onLaunch() {
    content.readyForKanji().catch((error) => console.warn('[app] 内容分包稍后重试', error));
  }
});
