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
/** 时间线：每一段从启动起多少毫秒开始、花了多久（最近 300 条）。浮层不显示，开发者工具里从 globalThis.__shushugoPerf 读。 */
export const perfTimeline: Array<{ phase: string; at: number; ms: number }> = [];
/** 每条 SQL（按语句开头 80 字）累计耗时和执行次数：iPhone 上 wasm 解释执行，卡顿多半是成批的 SQL。 */
export const perfSql = new Map<string, { ms: number; n: number }>();
if (enabled) (globalThis as typeof globalThis & { __shushugoPerf?: unknown }).__shushugoPerf = { perfPhases, perfTimeline, perfSql };
const pushTimeline = (phase: string, started: number, ms: number) => {
  perfTimeline.push({ phase, at: Math.round(started - startupStartedAt), ms: Math.round(ms) });
  if (perfTimeline.length > 300) perfTimeline.shift();
};
/** 最近开始的一段，「卡住」记录拿它当标签（被占住的那一下多半就是它，或紧跟在它后面）。 */
let lastPhase = '';
let freezeTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 逻辑线程被占住多久：每 100 ms 打一次点，两次之间多出 250 ms 以上就记一笔「卡住 · 最近那一段」。
 * 用户说的「点了很卡」多半是同一时刻后台有别的重活（整库落盘、保存计划），只量点击本身看不出来（2026-10-19）。
 */
const startFreezeWatch = () => {
  if (freezeTimer) return;
  let last = performance.now();
  freezeTimer = setInterval(() => {
    const now = performance.now();
    const stalled = now - last - 100;
    last = now;
    if (stalled > 250) {
      perfRecord(`卡住 · ${lastPhase || '未标记'}`, stalled);
      pushTimeline(`【卡住】最近：${lastPhase || '未标记'}`, now - stalled - 100, stalled);
    }
  }, 100);
};

export const startStartupTiming = () => {
  if (!enabled) return;
  startupStartedAt = performance.now();
  startupActive = true;
  startFreezeWatch();
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
  lastPhase = phase;
  const started = performance.now();
  try {
    return run();
  } finally {
    perfRecord(phase, performance.now() - started);
    pushTimeline(phase, started, performance.now() - started);
  }
};

export const perfTimeAsync = <T>(phase: string, run: () => Promise<T>): Promise<T> => {
  if (!enabled) return run();
  lastPhase = phase;
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
      pushTimeline(phase, started, performance.now() - started);
      return value;
    },
    (error) => {
      perfRecord(phase, performance.now() - started);
      throw error;
    }
  );
};

type SqlModule = { Database?: { prototype: Record<string, unknown> }; __perfSql?: boolean };
/**
 * 计时版：给 sql.js 的 exec / run / prepare / step 套一层计时，按语句累计（嵌套调用只算最外层）。
 * 普通构建里直接返回，不改原型。
 */
export const perfInstrumentSql = <T>(module: T): T => {
  const SQL = module as unknown as SqlModule;
  if (!enabled || SQL.__perfSql) return module;
  SQL.__perfSql = true;
  const key = (sql: unknown) => String(sql).replace(/\s+/g, ' ').trim().slice(0, 80);
  const statementKeys = new WeakMap<object, string>();
  let depth = 0;
  const timed = (target: Record<string, unknown>, method: string, keyOf: (self: object, args: unknown[]) => string | undefined, after?: (self: object, args: unknown[], result: unknown) => void) => {
    const original = target[method] as (...args: unknown[]) => unknown;
    target[method] = function (this: object, ...args: unknown[]) {
      depth += 1;
      const started = performance.now();
      try {
        const result = original.apply(this, args);
        after?.(this, args, result);
        return result;
      } finally {
        depth -= 1;
        const sqlKey = depth === 0 ? keyOf(this, args) : undefined;
        if (sqlKey) {
          const entry = perfSql.get(sqlKey) ?? { ms: 0, n: 0 };
          entry.ms += performance.now() - started;
          entry.n += 1;
          perfSql.set(sqlKey, entry);
        }
      }
    };
  };
  const database = SQL.Database?.prototype;
  if (!database) return module;
  let statementPatched = false;
  timed(database, 'exec', (_self, args) => key(args[0]));
  timed(database, 'run', (_self, args) => key(args[0]));
  // 小程序那份 vendored sql.js 不导出 Statement：拿到第一条语句时再给它的原型套计时
  timed(database, 'prepare', (_self, args) => key(args[0]), (_self, args, result) => {
    if (!result || typeof result !== 'object') return;
    statementKeys.set(result, key(args[0]));
    if (statementPatched) return;
    statementPatched = true;
    const statement = Object.getPrototypeOf(result) as Record<string, unknown>;
    for (const method of ['step', 'run', 'get', 'getAsObject']) if (typeof statement[method] === 'function') timed(statement, method, (self) => statementKeys.get(self));
  });
  return module;
};

/** 浮层用：累计最久的几条 SQL。 */
export const topSql = (limit = 6) => [...perfSql.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, limit);
