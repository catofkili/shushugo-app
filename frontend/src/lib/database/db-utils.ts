/**
 * 数据库工具函数
 */

import { getDatabase } from '../database';

export type SqlValue = string | number | null;
export type DbRow = Record<string, SqlValue>;

/**
 * 执行查询并返回第一个值
 */
export function firstValue<T = SqlValue>(query: string, params: SqlValue[] = [], fallback: T): T {
  const result = getDatabase().exec(query, params);
  if (!result.length || !result[0].values.length) return fallback;
  return result[0].values[0][0] as T;
}

/**
 * 执行查询并返回所有行（作为对象数组）
 */
export function rowsFor(query: string, params: SqlValue[] = []): DbRow[] {
  const result = getDatabase().exec(query, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((valueRow) => {
    const row: DbRow = {};
    columns.forEach((column, index) => {
      row[column] = valueRow[index] as SqlValue;
    });
    return row;
  });
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
