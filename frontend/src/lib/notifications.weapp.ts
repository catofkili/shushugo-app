import { Preferences } from "@capacitor/preferences";

declare const require: (path: string) => any;

export interface ReminderSettings {
  studyReminder: boolean;
  reviewReminder: boolean;
  achievementNotif: boolean;
  soundEnabled: boolean;
  studyTime: string;
  reviewTime: string;
  weeklyReportReminder: boolean;
  jlptReminder: boolean;
  jlptTime: string;
}
export interface ReminderSyncResult {
  permission: "granted" | "denied" | "prompt";
  native: boolean;
  pendingCount: number;
}
export interface JlptReminderInput {
  target: string; examEndAt: Date; daysLeft: number; todayText: string; todayClear: boolean;
  newWordsPerDay: number; newGrammarPerDay: number; feasible: boolean;
}

export const WEEKLY_REPORT_NOTIFICATION_EVENT = "weekly-report-notification";
const SETTINGS_KEY = "mn_notification_settings";
export const defaultReminderSettings: ReminderSettings = {
  studyReminder: false, reviewReminder: false, achievementNotif: false, soundEnabled: true,
  studyTime: "20:00", reviewTime: "20:00", weeklyReportReminder: false, jlptReminder: false, jlptTime: "20:30"
};
const configured = () => {
  try {
    const config = require("../../../wechat-miniprogram/src/config.js");
    const releaseConfig = require("../../../taro-spike-2/src/platform/release-config.weapp.cjs");
    return releaseConfig.release.reminders === true && Boolean(config.reminderTemplateId);
  } catch { return false; }
};
const reminder = () => require("../../../wechat-miniprogram/src/runtime/reminder.js");

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const { value } = await Preferences.get({ key: SETTINGS_KEY });
  try { return { ...defaultReminderSettings, ...(value ? JSON.parse(value) : {}) }; }
  catch { return defaultReminderSettings; }
}
export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(settings) });
}
export async function checkReminderPermission(): Promise<ReminderSyncResult> {
  if (!configured()) return { permission: "prompt", native: false, pendingCount: 0 };
  try {
    const status = await reminder().status();
    return { permission: status.configured ? "granted" : "prompt", native: true, pendingCount: status.credits };
  } catch { return { permission: "prompt", native: false, pendingCount: 0 }; }
}
export async function syncReminderNotifications(settings: ReminderSettings, requestPermission = false): Promise<ReminderSyncResult> {
  // wx.requestSubscribeMessage 必须在点击调用本函数的同步栈里触发。
  if (requestPermission && settings.studyReminder && configured()) reminder().bank();
  await saveReminderSettings(settings);
  return checkReminderPermission();
}
export async function syncWeeklyReportNotification(_settings?: ReminderSettings, _requestPermission = false, _now?: Date): Promise<ReminderSyncResult> { return checkReminderPermission(); }
export async function cancelWeeklyReportNotification(): Promise<void> {}
export async function autoSyncWeeklyReportNotification(): Promise<ReminderSyncResult> { return checkReminderPermission(); }
export async function syncJlptPlanNotifications(_input: JlptReminderInput | null): Promise<ReminderSyncResult> { return checkReminderPermission(); }
export async function autoSyncReminderNotifications(): Promise<ReminderSyncResult> { return checkReminderPermission(); }
export async function sendStudyReminderTest(): Promise<ReminderSyncResult> { return checkReminderPermission(); }
export async function notifyAchievement(_achievement?: string): Promise<null> { return null; }
export async function registerNotificationActionListener(): Promise<void> {}
export function consumePendingWeeklyReportWeekStart(): string | null { return null; }
