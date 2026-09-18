import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;

vi.mock("../database", () => ({
  getDatabase: () => db
}));

const {
  listWeeklyReportEvents,
  recordWeeklyReportEvent,
  weeklyReportEventCounts,
  WEEKLY_REPORT_EVENTS_KEY
} = await import("./weekly-report-events");

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
});

beforeEach(() => {
  db.run("DROP TABLE IF EXISTS app_state");
  db.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
});

describe("周报本地观测台账", () => {
  it("同类同周同入口只记一次", () => {
    recordWeeklyReportEvent({ kind: "opened", weekStart: "2026-09-06", at: 1, entry: "button" });
    recordWeeklyReportEvent({ kind: "opened", weekStart: "2026-09-06", at: 2, entry: "button" });
    expect(listWeeklyReportEvents()).toHaveLength(1);
  });

  it("不同入口分开记，便于区分来源", () => {
    recordWeeklyReportEvent({ kind: "opened", weekStart: "2026-09-06", at: 1, entry: "button" });
    recordWeeklyReportEvent({ kind: "opened", weekStart: "2026-09-06", at: 2, entry: "pull" });
    recordWeeklyReportEvent({ kind: "opened", weekStart: "2026-09-06", at: 3, entry: "notification" });
    expect(listWeeklyReportEvents()).toHaveLength(3);
  });

  it("不同周各自计数，不合并成一条", () => {
    recordWeeklyReportEvent({ kind: "available", weekStart: "2026-09-06", at: 1 });
    recordWeeklyReportEvent({ kind: "available", weekStart: "2026-08-30", at: 2 });
    expect(weeklyReportEventCounts()).toEqual({ available: 2 });
  });

  it("只记录枚举阶段，不写入错误正文", () => {
    recordWeeklyReportEvent({ kind: "failed", weekStart: "unknown", at: 1, stage: "load" });
    const [event] = listWeeklyReportEvents();
    expect(event.stage).toBe("load");
    expect(Object.keys(event).sort()).toEqual(["at", "kind", "stage", "weekStart"]);
  });

  it("台账损坏时静默返回空，不抛给调用方", () => {
    db.run("INSERT INTO app_state (key, value) VALUES (?, ?)", [WEEKLY_REPORT_EVENTS_KEY, "{not json"]);
    expect(listWeeklyReportEvents()).toEqual([]);
    recordWeeklyReportEvent({ kind: "opened", weekStart: "2026-09-06", at: 1 });
    expect(listWeeklyReportEvents()).toHaveLength(1);
  });

  it("没有周标识时不记", () => {
    recordWeeklyReportEvent({ kind: "opened", weekStart: "", at: 1 });
    expect(listWeeklyReportEvents()).toEqual([]);
  });
});
