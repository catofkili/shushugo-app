/**
 * 作答每一段花了多少毫秒（每段留最近 20 次）。只有小程序的计时版预览会读出来显示
 * （taro-spike-2/src/platform/preview-timing.weapp.tsx 的 PerfOverlay）。只有 TARO_PERF_OVERLAY=1 时记录；普通构建直接跑原操作。
 * 为什么要它：iPhone 上 JS 和 SQLite(wasm) 都是解释执行，桌面量出来的比例不能直接套，得在真机上看时间花在哪（2026-09-26）。
 */
declare const __TARO_PERF_OVERLAY__: boolean;

const enabled = typeof __TARO_PERF_OVERLAY__ !== 'undefined' && __TARO_PERF_OVERLAY__;
const STARTUP_PREFIX = '启动 · ';
let startupStartedAt = 0;
let startupActive = false;

export const perfPhases = new Map<string, number[]>();

export const startStartupTiming = () => {
  if (!enabled) return;
  startupStartedAt = performance.now();
  startupActive = true;
  for (const phase of perfPhases.keys()) {
    if (phase.startsWith(STARTUP_PREFIX)) perfPhases.delete(phase);
  }
};

export const recordStartupMilestone = (phase: string) => {
  if (!startupActive) return;
  perfRecord(`${STARTUP_PREFIX}${phase}`, performance.now() - startupStartedAt);
};

export const finishStartupTiming = (phase: string) => {
  recordStartupMilestone(phase);
  startupActive = false;
};

export const perfRecord = (phase: string, value: number) => {
  if (!enabled || (phase.startsWith(STARTUP_PREFIX) && !startupActive)) return;
  const list = perfPhases.get(phase) ?? [];
  list.push(Math.round(value));
  if (list.length > 20) list.shift();
  perfPhases.set(phase, list);
};

export const perfTime = <T>(phase: string, run: () => T): T => {
  if (!enabled) return run();
  const started = performance.now();
  try {
    return run();
  } finally {
    perfRecord(phase, performance.now() - started);
  }
};

export const perfTimeAsync = <T>(phase: string, run: () => Promise<T>): Promise<T> => {
  if (!enabled) return run();
  const started = performance.now();
  let pending: Promise<T>;
  try {
    pending = run();
  } catch (error) {
    perfRecord(phase, performance.now() - started);
    throw error;
  }
  return pending.then(
    (value) => {
      perfRecord(phase, performance.now() - started);
      return value;
    },
    (error) => {
      perfRecord(phase, performance.now() - started);
      throw error;
    }
  );
};
