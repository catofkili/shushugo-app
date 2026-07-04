import { Capacitor } from "@capacitor/core";
import { LocalNotifications, type PermissionStatus } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";

export interface ReminderSettings {
  studyReminder: boolean;
  reviewReminder: boolean;
  achievementNotif: boolean;
  soundEnabled: boolean;
  studyTime: string;
  reviewTime: string;
}

export interface ReminderSyncResult {
  permission: PermissionStatus["display"];
  native: boolean;
  pendingCount: number;
}

const SETTINGS_KEY = "mn_notification_settings";
const STUDY_NOTIFICATION_ID = 9101;
const REVIEW_NOTIFICATION_ID = 9102;
const ACHIEVEMENT_NOTIFICATION_BASE_ID = 9200;
const TEST_STUDY_NOTIFICATION_ID = 9301;
const REMINDER_IDS = [{ id: STUDY_NOTIFICATION_ID }, { id: REVIEW_NOTIFICATION_ID }];

export const defaultReminderSettings: ReminderSettings = {
  studyReminder: true,
  reviewReminder: true,
  achievementNotif: true,
  soundEnabled: true,
  studyTime: "09:00",
  reviewTime: "20:00"
};

const isNativeNotificationsAvailable = () => Capacitor.isNativePlatform();

const parseTime = (value: string) => {
  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 9,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0
  };
};

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const { value } = await Preferences.get({ key: SETTINGS_KEY });
  if (!value) return defaultReminderSettings;
  try {
    return { ...defaultReminderSettings, ...JSON.parse(value) };
  } catch {
    return defaultReminderSettings;
  }
}

export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(settings) });
}

export async function checkReminderPermission(): Promise<ReminderSyncResult> {
  if (!isNativeNotificationsAvailable()) {
    return { permission: "granted", native: false, pendingCount: 0 };
  }
  const permission = await LocalNotifications.checkPermissions();
  const pending = await LocalNotifications.getPending();
  return { permission: permission.display, native: true, pendingCount: pending.notifications.length };
}

export async function syncReminderNotifications(settings: ReminderSettings, requestPermission = false): Promise<ReminderSyncResult> {
  await saveReminderSettings(settings);

  if (!isNativeNotificationsAvailable()) {
    return { permission: "granted", native: false, pendingCount: 0 };
  }

  let permission = await LocalNotifications.checkPermissions();
  const needsNotification = settings.studyReminder || settings.reviewReminder;
  if (needsNotification && permission.display !== "granted" && requestPermission) {
    permission = await LocalNotifications.requestPermissions();
  }

  await LocalNotifications.cancel({ notifications: REMINDER_IDS });

  if (needsNotification && permission.display === "granted") {
    const notifications = [];
    if (settings.studyReminder) {
      const { hour, minute } = parseTime(settings.studyTime);
      notifications.push({
        id: STUDY_NOTIFICATION_ID,
        title: "Master 日语",
        body: "今天也来学一点日语吧，几分钟就够。",
        schedule: { on: { hour, minute }, repeats: true },
        sound: settings.soundEnabled ? "" : undefined,
        threadIdentifier: "daily-study",
        extra: { target: "word" }
      });
    }
    if (settings.reviewReminder) {
      const { hour, minute } = parseTime(settings.reviewTime);
      notifications.push({
        id: REVIEW_NOTIFICATION_ID,
        title: "复习时间到了",
        body: "把快忘的单词和语法捞回来。",
        schedule: { on: { hour, minute }, repeats: true },
        sound: settings.soundEnabled ? "" : undefined,
        threadIdentifier: "daily-review",
        extra: { target: "review" }
      });
    }
    await LocalNotifications.schedule({ notifications });
  }

  const pending = await LocalNotifications.getPending();
  return { permission: permission.display, native: true, pendingCount: pending.notifications.length };
}

export async function autoSyncReminderNotifications(): Promise<ReminderSyncResult> {
  const settings = await loadReminderSettings();
  const status = await checkReminderPermission();
  if (!status.native || status.permission !== "granted") return status;
  return syncReminderNotifications(settings, false);
}

export async function sendStudyReminderTest(): Promise<ReminderSyncResult> {
  const settings = await loadReminderSettings();

  if (!isNativeNotificationsAvailable()) {
    return { permission: "granted", native: false, pendingCount: 0 };
  }

  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== "granted") {
    const pending = await LocalNotifications.getPending();
    return { permission: permission.display, native: true, pendingCount: pending.notifications.length };
  }

  await LocalNotifications.cancel({ notifications: [{ id: TEST_STUDY_NOTIFICATION_ID }] });
  await LocalNotifications.schedule({
    notifications: [{
      id: TEST_STUDY_NOTIFICATION_ID,
      title: "Master 日语学习提醒",
      body: "测试通知已接通。之后会按你设置的时间提醒学习。",
      schedule: { at: new Date(Date.now() + 2000) },
      sound: settings.soundEnabled ? "" : undefined,
      threadIdentifier: "daily-study",
      extra: { target: "word", test: true }
    }]
  });

  const synced = await syncReminderNotifications(settings, false);
  return synced;
}

export async function notifyAchievement(achievement: string): Promise<ReminderSyncResult | null> {
  const settings = await loadReminderSettings();
  if (!settings.achievementNotif || !isNativeNotificationsAvailable()) return null;

  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== "granted") {
    const pending = await LocalNotifications.getPending();
    return { permission: permission.display, native: true, pendingCount: pending.notifications.length };
  }

  await LocalNotifications.schedule({
    notifications: [{
      id: ACHIEVEMENT_NOTIFICATION_BASE_ID + Math.floor(Date.now() % 1000),
      title: "获得成就",
      body: `${achievement} 已解锁。`,
      schedule: { at: new Date(Date.now() + 1000) },
      sound: settings.soundEnabled ? "" : undefined,
      threadIdentifier: "achievement",
      extra: { target: "profile", achievement }
    }]
  });
  const pending = await LocalNotifications.getPending();
  return { permission: permission.display, native: true, pendingCount: pending.notifications.length };
}
