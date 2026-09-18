import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;
vi.mock("../database", () => ({ getDatabase: () => db }));
vi.mock("./schema", () => ({ getDeviceId: () => "device-a" }));

const { recordReportStudySeconds } = await import("./study-time");

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
});

beforeEach(() => {
  db.run("DROP TABLE IF EXISTS study_time_by_period");
  db.run("CREATE TABLE study_time_by_period (period_start TEXT, device_id TEXT, seconds INTEGER, PRIMARY KEY(period_start, device_id))");
});

const rows = (): Array<[string, number]> => {
  const result = db.exec("SELECT period_start, seconds FROM study_time_by_period ORDER BY period_start")[0];
  return (result?.values ?? []).map(([period, seconds]) => [String(period), Number(seconds)]);
};

describe("周日 14:00 计时分段", () => {
  it("跨边界的十五秒正确拆成十秒和五秒", () => {
    recordReportStudySeconds(new Date(2026, 8, 13, 14, 0, 5).getTime(), 15);
    expect(rows()).toEqual([["2026-09-06 14:00", 10], ["2026-09-13 14:00", 5]]);
  });

  it("毫秒落点不会因两边各自四舍五入凭空多一秒", () => {
    recordReportStudySeconds(new Date(2026, 8, 13, 14, 0, 0, 500).getTime(), 15);
    const split = rows();
    expect(split.reduce((sum, [, seconds]) => sum + seconds, 0)).toBe(15);
  });
});
