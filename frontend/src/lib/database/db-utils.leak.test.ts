/**
 * sql.js 长驻 WebView 回归：Database.exec() 在大量重复读查询后会耗尽 WASM 堆。
 * 读路径改用 prepare/step/free 后，50 万次 firstValue 应保持可用。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("../database", () => ({
  getDatabase: () => testDb
}));

import { firstValue } from "./db-utils";

describe("数据库读路径不会累积 exec WASM 结果", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    // 这个哨兵只验证 prepare/step/free 是否在长循环中释放结果对象，
    // 不应被正式词库的行数、内容或二进制增长牵连。几百行的小表已经
    // 足以让参数查询走真实 SQL 路径，同时让测试几十倍更轻。
    testDb = new SQL.Database();
    testDb.run(`
      CREATE TABLE words (id INTEGER PRIMARY KEY);
      WITH RECURSIVE numbers(value) AS (
        SELECT 0
        UNION ALL
        SELECT value + 1 FROM numbers WHERE value < 511
      )
      INSERT INTO words (id) SELECT value FROM numbers;
    `);
  });

  afterAll(() => testDb.close());

  it("同一数据库连续 500000 次参数查询不崩溃", () => {
    for (let index = 0; index < 500_000; index += 1) {
      expect(firstValue<number>("SELECT COUNT(*) FROM words WHERE id > ?", [index % 100], -1)).toBeGreaterThan(0);
    }
  }, 120_000);
});
