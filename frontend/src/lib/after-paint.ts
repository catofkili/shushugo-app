/** rAF 回调在绘制之前；再让出一个任务，才允许同步查库。返回值供卸载/新事件取消旧计算。 */
export function afterPaint(work: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => { timer = setTimeout(work, 0); });
  return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
}
