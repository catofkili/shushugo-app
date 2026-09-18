import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(async (_input: { notifications: Array<{ schedule: { at: Date }; extra: { weekStart: string } }> }) => undefined),
  cancel: vi.fn(async () => undefined),
  generate: vi.fn(),
  metrics: { totalReviews: 0, totalSeconds: 0 }
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    getPending: async () => ({ notifications: [] }),
    cancel: mocks.cancel,
    schedule: mocks.schedule,
    addListener: vi.fn()
  }
}));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));
vi.mock("./analytics/weekly-reports", () => ({ generateLatestWeeklyReport: mocks.generate }));
vi.mock("./analytics/weekly", () => ({
  getWeekWindow: () => ({ start: "2026-09-06", end: "2026-09-12", startAt: 0, endAt: 1 }),
  getWeeklyMetrics: () => mocks.metrics,
  passesThreshold: (metrics: { totalReviews: number; totalSeconds: number }) => metrics.totalReviews > 0 || metrics.totalSeconds > 0
}));
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), saveDatabase: vi.fn(async () => undefined) }));

const { defaultReminderSettings, syncWeeklyReportNotification } = await import("./notifications");

describe("周报通知", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.metrics.totalReviews = 0;
    mocks.metrics.totalSeconds = 0;
    mocks.generate.mockReturnValue(null);
  });

  afterEach(() => vi.useRealTimers());

  it("本期已有学习时可在周日 14:00 前预排 14:30", async () => {
    mocks.metrics.totalReviews = 1;
    const result = await syncWeeklyReportNotification(defaultReminderSettings, false, new Date(2026, 8, 13, 13, 50));
    expect(result.retryWeeklyReportSoon).toBe(false);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    const notification = mocks.schedule.mock.calls[0][0].notifications[0];
    expect(notification.schedule.at.getHours()).toBe(14);
    expect(notification.schedule.at.getMinutes()).toBe(30);
    expect(notification.extra.weekStart).toBe("2026-09-06");
  });

  it("首次用户尚无学习时保持轮询资格", async () => {
    const result = await syncWeeklyReportNotification(defaultReminderSettings, false, new Date(2026, 8, 7, 10, 0));
    expect(result.retryWeeklyReportSoon).toBe(true);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("周日 14:00 后先保存成品再安排通知", async () => {
    mocks.generate.mockReturnValue({ report: { window: { start: "2026-09-06" } } });
    const result = await syncWeeklyReportNotification(defaultReminderSettings, false, new Date(2026, 8, 13, 14, 1));
    expect(result.retryWeeklyReportSoon).toBe(false);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });

  it("已读周报不会被前台同步重新排期", async () => {
    mocks.generate.mockReturnValue({ readAt: 123, report: { window: { start: "2026-09-06" } } });
    await syncWeeklyReportNotification(defaultReminderSettings, false, new Date(2026, 8, 13, 14, 1));
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
