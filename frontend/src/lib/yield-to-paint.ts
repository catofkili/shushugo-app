/**
 * 让浏览器先把当前这一帧画出来，再做后面那段同步的重活（词库查询、导出 SQLite）。
 *
 * **不能只等 requestAnimationFrame。** 页面在后台标签页、或者 App 切到后台时，
 * rAF 根本不会触发，这个 await 就一直挂着 —— 实测隐藏标签页里打开设置页，
 * 「存储空间」永远停在 0 B、学习强度的每日估算永远是空的，因为算它们的那段代码
 * 卡在 await 上没跑到。定时器不受影响，所以两个都挂上，谁先到算谁。
 */
export const yieldToPaint = (): Promise<void> => new Promise<void>((resolve) => {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    resolve();
  };
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(finish);
  // 前台时 rAF 先到（约 16ms），这条只是兜底
  setTimeout(finish, 50);
});
