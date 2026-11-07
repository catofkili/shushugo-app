/** rAF 回调在绘制之前；再让出一个任务，才允许同步查库。返回值供卸载/新事件取消旧计算。
 *  后台标签页 / App 在后台时 rAF 不触发（同 yield-to-paint.ts 的坑：首页会一直停在「计算中…」），
 *  所以再挂一个 50ms 定时器兜底，谁先到算谁。 */
export function afterPaint(work: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  const run = () => {
    if (started) return;
    started = true;
    timer = setTimeout(work, 0);
  };
  const frame = requestAnimationFrame(run);
  const fallback = setTimeout(run, 50);
  return () => { started = true; cancelAnimationFrame(frame); clearTimeout(fallback); clearTimeout(timer); };
}
