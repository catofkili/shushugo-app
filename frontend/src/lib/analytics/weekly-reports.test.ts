import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;

vi.mock("../database", () => ({
  getDatabase: () => db
}));

const {
  backfillWeeklyReports,
  generateWeeklyReport,
  getWeeklyReport,
  getWeeklyReportNotice,
  listWeeklyReports,
  markWeeklyReportRead,
  reportWindowLabel,
  saveWeeklyReport
} = await import("./weekly-reports");

const at = (d: number, hour: number) => new Date(2026, 8, d, hour).getTime();

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
});

beforeEach(() => {
  for (const table of ["reviews", "grammar_reviews", "kanji_unit_reviews", "word_study_time", "study_time_by_period", "weekly_reports"]) {
    db.run(`DROP TABLE IF EXISTS ${table}`);
  }
  db.run(`CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    answer TEXT NOT NULL,
    reviewed_on TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'forward',
    reviewed_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run("CREATE TABLE grammar_reviews (id INTEGER PRIMARY KEY, grammar_id INTEGER, answer TEXT, reviewed_on TEXT, created_at TEXT)");
  db.run("CREATE TABLE kanji_unit_reviews (id INTEGER PRIMARY KEY, unit_key TEXT, answer TEXT, reviewed_on TEXT, reviewed_at INTEGER, created_at TEXT)");
  db.run("CREATE TABLE word_study_time (studied_on TEXT PRIMARY KEY, seconds INTEGER, updated_at TEXT)");
  db.run("CREATE TABLE study_time_by_period (period_start TEXT, device_id TEXT, seconds INTEGER, PRIMARY KEY(period_start, device_id))");
});

const addReview = (id: number, wordId: number, day: number) => {
  db.run(
    "INSERT INTO reviews (id, word_id, answer, reviewed_on, direction, reviewed_at) VALUES (?, ?, 'know', ?, 'forward', ?)",
    [id, wordId, `2026-09-${String(day).padStart(2, "0")}`, at(day, 15)]
  );
};

describe("本地周报快照", () => {
  it("没有学习记录时不创建空周报", () => {
    expect(generateWeeklyReport("local", 0, "2026-09-13T15:00:00")).toBeNull();
    expect(listWeeklyReports()).toHaveLength(0);
  });

  it("按周保存并可重复读取", () => {
    addReview(1, 101, 7);
    const first = generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    expect(first?.report.window.start).toBe("2026-09-06");
    expect(first?.report.metrics.totalReviews).toBe(1);
    expect(reportWindowLabel(first!.report.window)).toBe("9 月 6 日 14:00—9 月 13 日 14:00");

    addReview(2, 102, 8);
    const second = generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    expect(second?.generatedAt).toBe(first?.generatedAt);
    expect(second?.report.metrics.totalReviews).toBe(1);
    expect(listWeeklyReports()).toHaveLength(1);
  });

  it("不同周各自一份，历史快照不混入未来数据", () => {
    addReview(1, 101, 7);
    addReview(2, 102, 1);
    const current = generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    const previous = generateWeeklyReport("local", -1, "2026-09-13T15:00:00");
    expect(current?.report.metrics.totalReviews).toBe(1);
    expect(previous?.report.metrics.totalReviews).toBe(1);
    expect(listWeeklyReports()).toHaveLength(2);
  });

  it("阅读状态独立于报告正文", () => {
    addReview(1, 101, 7);
    const snapshot = generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    expect(snapshot?.readAt).toBeNull();
    expect(markWeeklyReportRead("2026-09-06", 123456)).toBe(true);
    expect(markWeeklyReportRead("2026-09-06", 999999)).toBe(false);
    expect(getWeeklyReport("2026-09-06")?.readAt).toBe(123456);
    expect(getWeeklyReport("2026-09-06")?.report.metrics.totalReviews).toBe(1);
  });

  it("云同步补入记录后不暗改已经读过的快照", () => {
    addReview(1, 101, 7);
    const original = generateWeeklyReport("local", 0, "2026-09-13T15:00:00")!;
    markWeeklyReportRead("2026-09-06", 123456);
    addReview(2, 102, 8);

    const afterSync = generateWeeklyReport("local", 0, "2026-09-13T15:00:00", true)!;
    expect(afterSync.generatedAt).toBe(original.generatedAt);
    expect(afterSync.readAt).toBe(123456);
    expect(afterSync.report.metrics.totalReviews).toBe(1);
  });

  it("统计规则升级会重算旧快照但保留已读状态", () => {
    addReview(1, 101, 7);
    const original = generateWeeklyReport("local", 0, "2026-09-13T15:00:00")!;
    markWeeklyReportRead("2026-09-06", 123456);
    db.run("UPDATE weekly_reports SET schema_version = 2 WHERE week_start = '2026-09-06'");
    db.run(
      "INSERT INTO reviews (id, word_id, answer, reviewed_on, direction, reviewed_at) VALUES (2, 102, 'know', '2026-09-13', 'forward', ?)",
      [at(13, 13)]
    );

    const refreshed = generateWeeklyReport("local", 0, "2026-09-13T15:00:00")!;
    expect(refreshed.schemaVersion).toBe(original.schemaVersion);
    expect(refreshed.readAt).toBe(123456);
    expect(refreshed.report.metrics.totalReviews).toBe(2);
    expect(refreshed.report.metrics.daily).toHaveLength(7);
  });

  it("读取旧版八日快照时合并结束周日", () => {
    addReview(1, 101, 7);
    const current = generateWeeklyReport("local", 0, "2026-09-13T15:00:00")!;
    const legacy = {
      ...current.report,
      metrics: {
        ...current.report.metrics,
        days: 8,
        daily: [
          ...current.report.metrics.daily,
          { date: "2026-09-13", reviews: 1, newWords: 0, seconds: 12 }
        ]
      }
    };
    db.run("UPDATE weekly_reports SET schema_version = 2, content_json = ? WHERE week_start = '2026-09-06'", [JSON.stringify(legacy)]);
    const restored = getWeeklyReport("2026-09-06")!;
    expect(restored.report.metrics.daily).toHaveLength(7);
    expect(restored.report.metrics.daily[0].reviews).toBe(1);
    expect(restored.report.metrics.daily[0].seconds).toBe(12);
    expect(restored.report.metrics.days).toBe(7);
  });

  it("读取日格已是七天但天数残留八的旧快照时也修正天数", () => {
    addReview(1, 101, 7);
    const current = generateWeeklyReport("local", 0, "2026-09-13T15:00:00")!;
    const legacy = {
      ...current.report,
      metrics: { ...current.report.metrics, days: 8 }
    };
    db.run("UPDATE weekly_reports SET schema_version = 2, content_json = ? WHERE week_start = '2026-09-06'", [JSON.stringify(legacy)]);
    expect(getWeeklyReport("2026-09-06")!.report.metrics.days).toBe(7);
  });

  it("保存旧版云周报时补齐新增的可选页面", () => {
    addReview(1, 101, 7);
    const current = generateWeeklyReport("local", 0, "2026-09-13T15:00:00")!;
    const legacy = { ...current.report } as Partial<typeof current.report>;
    delete legacy.highlight;
    delete legacy.revisitWords;

    const saved = saveWeeklyReport(legacy as typeof current.report);
    expect(saved.report.highlight).toBeNull();
    expect(saved.report.revisitWords).toEqual([]);
  });
});

describe("旧周按需补算", () => {
  it("补出没有快照但有记录的历史周", () => {
    addReview(1, 101, 7);
    addReview(2, 102, 1);
    const result = backfillWeeklyReports("local", { maxWeeks: 4, now: "2026-09-13T15:00:00" });
    expect(result.generated).toBe(2);
    expect(listWeeklyReports().map((item) => item.report.window.start)).toEqual([
      "2026-09-06",
      "2026-08-30"
    ]);
  });

  it("已有快照不重复生成", () => {
    addReview(1, 101, 7);
    generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    const result = backfillWeeklyReports("local", { maxWeeks: 4, now: "2026-09-13T15:00:00" });
    expect(result.generated).toBe(0);
    expect(listWeeklyReports()).toHaveLength(1);
  });

  it("连续空周就停下，不扫穿全部历史", () => {
    addReview(1, 101, 7);
    const result = backfillWeeklyReports("local", { maxWeeks: 12, now: "2026-09-13T15:00:00" });
    expect(result.generated).toBe(1);
    // 生成那一周之后又扫了两周空周才停。
    expect(result.scanned).toBeLessThan(12);
    expect(result.stoppedByLimit).toBe(false);
  });

  it("单次扫描不超过上限", () => {
    for (const day of [7, 1]) addReview(day, day + 100, day);
    const result = backfillWeeklyReports("local", { maxWeeks: 2, now: "2026-09-13T15:00:00" });
    expect(result.scanned).toBe(2);
    expect(result.stoppedByLimit).toBe(true);
  });
});

describe("站内更新提醒", () => {
  const publish = () => new Date("2026-09-13T14:05:00");

  it("没有报告时不提示", () => {
    expect(getWeeklyReportNotice(publish())).toEqual({ state: "none", weekStart: null });
  });

  it("发布窗口内未读为 new", () => {
    addReview(1, 101, 7);
    generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    expect(getWeeklyReportNotice(publish())).toEqual({ state: "new", weekStart: "2026-09-06" });
  });

  it("读过之后不再提示", () => {
    addReview(1, 101, 7);
    generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    markWeeklyReportRead("2026-09-06", Date.now());
    expect(getWeeklyReportNotice(publish()).state).toBe("read");
  });

  it("周一 00:00 之后无条件消失", () => {
    addReview(1, 101, 7);
    generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    expect(getWeeklyReportNotice(new Date("2026-09-13T23:59:00")).state).toBe("new");
    expect(getWeeklyReportNotice(new Date("2026-09-14T00:00:00")).state).toBe("expired");
  });

  it("还没到发布时间不提前提示", () => {
    addReview(1, 101, 7);
    generateWeeklyReport("local", 0, "2026-09-13T15:00:00");
    expect(getWeeklyReportNotice(new Date("2026-09-13T13:00:00")).state).toBe("none");
  });
});
