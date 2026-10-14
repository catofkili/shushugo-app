import { afterEach, describe, expect, it, vi } from "vitest";

const scheduled: { id: number; body: string; schedule: { at: Date } }[] = [];
let snap = { today: "2026-10-14", streak: 5, todayStatus: "none" };

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: "granted" }),
    cancel: async () => undefined,
    schedule: async ({ notifications }: { notifications: typeof scheduled }) => { scheduled.push(...notifications); },
    getPending: async () => ({ notifications: scheduled })
  }
}));
vi.mock("./streak", () => ({ streakSnapshot: () => snap }));

const { defaultReminderSettings, syncReminderNotifications } = await import("./notifications");
const settings = { ...defaultReminderSettings, reviewReminder: false, studyTime: "09:00" };
const run = async (now: string, next: typeof snap) => {
  scheduled.length = 0;
  snap = next;
  vi.setSystemTime(new Date(now));
  await syncReminderNotifications(settings);
  return scheduled.map((n) => [n.schedule.at.getDate(), n.body] as const);
};

describe("学习提醒：一天一条，带连续天数（连胜规格 §6）", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("今天没亮：今天那条说天数，之后用通用正文", async () => {
    vi.useFakeTimers();
    const got = await run("2026-10-14T07:00:00", { today: "2026-10-14", streak: 5, todayStatus: "none" });
    expect(got).toHaveLength(28);
    expect(got[0]).toEqual([14, "连续 5 天，今天还没点火。"]);
    expect(got[1][1]).toBe("今天也来学一点日语吧，几分钟就够。");
  });

  it("今天已经亮了：不排今天，明天那条说天数", async () => {
    vi.useFakeTimers();
    const got = await run("2026-10-14T07:00:00", { today: "2026-10-14", streak: 6, todayStatus: "lit" });
    expect(got[0]).toEqual([15, "连续 6 天，今天也来点火。"]);
  });

  it("凌晨 2 点还属于昨天的学习日：今早 9 点那条是「明天」，不会因为昨天亮了被跳过", async () => {
    vi.useFakeTimers();
    const got = await run("2026-10-15T02:00:00", { today: "2026-10-14", streak: 6, todayStatus: "lit" });
    expect(got[0]).toEqual([15, "连续 6 天，今天也来点火。"]);
  });
});
