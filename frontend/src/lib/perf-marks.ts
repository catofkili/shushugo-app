/**
 * 作答每一段花了多少毫秒（每段留最近 20 次）。只有小程序的计时版预览会读出来显示
 * （taro-spike-2/src/platform/preview-timing.weapp.tsx 的 PerfOverlay），平时就是往数组里记几个数。
 * 为什么要它：iPhone 上 JS 和 SQLite(wasm) 都是解释执行，桌面量出来的比例不能直接套，得在真机上看时间花在哪（2026-09-26）。
 */
export const perfPhases = new Map<string, number[]>();

export const perfRecord = (phase: string, value: number) => {
  const list = perfPhases.get(phase) ?? [];
  list.push(Math.round(value));
  if (list.length > 20) list.shift();
  perfPhases.set(phase, list);
};

export const perfTime = <T>(phase: string, run: () => T): T => {
  const started = performance.now();
  try {
    return run();
  } finally {
    perfRecord(phase, performance.now() - started);
  }
};
