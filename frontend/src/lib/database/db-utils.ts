/**
 * 数据库工具函数
 */

import { getDatabase } from '../database';

export type SqlValue = string | number | null;
export type DbRow = Record<string, SqlValue>;

/**
 * 读取查询统一走 prepare/step/free。
 *
 * sql.js 的 Database.exec() 会为每次调用分配一份结果对象；在常驻 WebView
 * 上重复调用几十万次后 WASM 堆会耗尽，即使查询本身只有一行。prepare 的
 * statement 必须在 finally 中 free，才能让绑定参数和结果缓冲区及时回收。
 * 这里只接受单条 SQL；建表/迁移等多语句脚本继续使用 db.run/exec。
 */
const queryRows = (query: string, params: SqlValue[] = []): DbRow[] => {
  const statement = getDatabase().prepare(query);
  try {
    if (params.length) statement.bind(params);
    const result: DbRow[] = [];
    while (statement.step()) {
      result.push(statement.getAsObject() as DbRow);
    }
    return result;
  } finally {
    statement.free();
  }
};

/**
 * 「这个库只跑一次」的幂等闸门。
 *
 * ⚠️ 键是 **Database 实例本身**,不是模块级 boolean —— 云同步合并、恢复快照、
 * 导入备份都会整个换掉 db 实例,那时候这些初始化必须重跑一遍;用 boolean 的话
 * 换库之后 progress 行就永远补不上了。实例被丢掉时 WeakMap 自己会放手。
 *
 * ⚠️ 它挡的是「每次调用都重跑一遍全表扫描」,不是「这件事只需要做一次」。
 * 库里的行在同一个实例上变了(比如导入词单新增 words),得由那条路自己补上
 * 对应的 progress 行 —— 见 word-list-import 里那句 INSERT OR IGNORE。
 */
const oncePerDb = new WeakMap<object, Set<string>>();
export function oncePerDatabase(key: string, run: () => void): void {
  const db = getDatabase() as unknown as object;
  let done = oncePerDb.get(db);
  if (!done) {
    done = new Set<string>();
    oncePerDb.set(db, done);
  }
  if (done.has(key)) return;
  // 先跑再记:抛异常时不留标记,下次调用还会重试。
  run();
  done.add(key);
}

/**
 * 执行查询并返回第一个值
 */
export function firstValue<T = SqlValue>(query: string, params: SqlValue[] = [], fallback: T): T {
  const statement = getDatabase().prepare(query);
  try {
    if (params.length) statement.bind(params);
    if (!statement.step()) return fallback;
    return statement.get()[0] as T;
  } finally {
    statement.free();
  }
}

/**
 * 执行查询并返回所有行（作为对象数组）
 */
export function rowsFor(query: string, params: SqlValue[] = []): DbRow[] {
  return queryRows(query, params);
}

/**
 * 执行查询并返回第一行
 */
export function firstRow(query: string, params: SqlValue[] = []): DbRow | null {
  return rowsFor(query, params)[0] ?? null;
}

/**
 * 获取应用状态
 */
export function getState(key: string, fallback: string): string {
  return firstValue<string>(
    "SELECT value FROM app_state WHERE key = ?",
    [key],
    fallback
  );
}

/**
 * 设置应用状态
 */
export function setState(key: string, value: string): void {
  getDatabase().run("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", [key, value]);
}

/**
 * 计算日期差（天数）
 */
export function daysSince(dateText: SqlValue): number {
  if (!dateText) return 0;
  const parsed = new Date(`${String(dateText)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 0;
  const now = new Date(`${studyDate()}T00:00:00`);
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86400000));
}

/**
 * 获取学习日期（考虑凌晨4点之前算前一天）
 */
const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function studyDate(current = new Date()): string {
  const now = new Date(current);
  if (now.getHours() < 4) {
    now.setDate(now.getDate() - 1);
  }
  return localDateKey(now);
}

export const today = studyDate;

/**
 * 本学习日的结束时刻(下一个凌晨 4 点)。FSRS 用它判「今天是否已毕业」:
 * 学习/重学中的卡 due 只排到几分钟后(< 边界)→ 当天继续刷;
 * 毕业卡 due 排到明天及以后(> 边界)→ 今天不再出。
 */
export function studyDayEnd(current = new Date()): Date {
  const end = new Date(current);
  if (end.getHours() < 4) {
    // 还没过 4 点:属于昨天的学习日,今天 4 点结束
    end.setHours(4, 0, 0, 0);
  } else {
    end.setDate(end.getDate() + 1);
    end.setHours(4, 0, 0, 0);
  }
  return end;
}

/**
 * 调度保存数据库
 */
export function persistSoon(): void {
  import("../storage").then(({ scheduleSave }) => scheduleSave());
}

/**
 * 内容迁移之后的落盘:**强制整库**。
 *
 * ⚠️ 内容迁移改的是 `words` / `grammar_points` / `dictionary_entries` 这些
 * **不带 sync_updated_at、因而不进增量**的表,而它写下的版本号在 `app_state`,
 * 那张表是进增量的。用普通 persistSoon 的话,离下一次整库还有几分钟时重启,
 * 拿到的就是**旧内容 + 新版本号** —— 而迁移的入口判断是「版本号相等就返回」,
 * 于是这台设备的内容永远停在旧版,每次启动都在同一个相等判断上早退。
 * 「反正每次启动幂等重跑」在这里不成立,版本门控把重跑挡住了。
 */
export function persistContentSoon(): void {
  import("../storage").then(({ requestFullSnapshot, scheduleSave }) => {
    requestFullSnapshot();
    scheduleSave();
  });
}
