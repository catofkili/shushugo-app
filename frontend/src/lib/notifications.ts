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
  /** 备考计划提醒:每天播报「今天最少还要做多少」才不掉队 */
  jlptReminder: boolean;
  jlptTime: string;
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

/**
 * 备考提醒占 9400 起的一段,一天一个 id。
 *
 * 为什么不像学习/复习提醒那样用一条 `repeats: true`:那条的正文是写死的,
 * 而备考提醒每天要说不同的话(倒计时在变、今天还差多少在变)。
 * iOS 的本地通知一旦排进系统就改不了正文,所以只能一天排一条,
 * 每次打开 App 重排一次(见 syncJlptPlanNotifications)。
 */
const JLPT_NOTIFICATION_BASE_ID = 9400;
const JLPT_NOTIFICATION_DAYS = 14;
const JLPT_NOTIFICATION_IDS = Array.from(
  { length: JLPT_NOTIFICATION_DAYS },
  (_, index) => ({ id: JLPT_NOTIFICATION_BASE_ID + index })
);

export const defaultReminderSettings: ReminderSettings = {
  studyReminder: true,
  reviewReminder: true,
  achievementNotif: true,
  soundEnabled: true,
  studyTime: "09:00",
  reviewTime: "20:00",
  jlptReminder: true,
  // 放在晚上:这条说的是「今天还差多少」,得留得下当晚补的时间,早上报没有意义
  jlptTime: "20:30"
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
        title: "收集日",
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

/**
 * 备考提醒要用到的数据。刻意收成一个扁平结构:
 * notifications.ts 不该 import 数据库或偏好,不然测试和预览环境都得跟着背一整条依赖链。
 * 调用方(App.tsx)从 getJlptPlanStatus() 组好了传进来。
 */
export interface JlptReminderInput {
  target: string;
  daysLeft: number;
  /** 今天还差多少的那句话,已经由 jlpt/plan.ts 拼好 */
  todayText: string;
  /** 今天的最低量是不是已经做完了 —— 做完了就不发今天这条 */
  todayClear: boolean;
  /** 之后每天的最低新增量,用来写未来几天的正文 */
  newWordsPerDay: number;
  newGrammarPerDay: number;
  /** 计划本身不可行(按上限也吃不完),正文要说实话而不是继续催 */
  feasible: boolean;
}

const jlptBodyFor = (input: JlptReminderInput, dayOffset: number): string => {
  const daysLeft = input.daysLeft - dayOffset;
  const head = `距 ${input.target} 还有 ${daysLeft} 天`;
  if (daysLeft <= 0) return "今天就是考试日,加油。";
  if (!input.feasible) {
    return `${head} · 按剩下的天数已经排不完了,进来看看要砍哪一块。`;
  }
  if (dayOffset === 0) {
    return `${head} · ${input.todayText}`;
  }
  const parts: string[] = [];
  if (input.newWordsPerDay > 0) parts.push(`新词 ${input.newWordsPerDay}`);
  if (input.newGrammarPerDay > 0) parts.push(`语法 ${input.newGrammarPerDay}`);
  const intake = parts.length ? `,再加 ${parts.join(" · ")}` : "";
  return `${head} · 今天最少把到期的清掉${intake}。`;
};

/**
 * 重排未来 JLPT_NOTIFICATION_DAYS 天的备考提醒。
 * 每次打开 App 调一次就行——排得再远也会被下一次打开覆盖掉,
 * 两周的余量是给「连着半个月没打开」留的。
 */
export async function syncJlptPlanNotifications(
  input: JlptReminderInput | null
): Promise<ReminderSyncResult> {
  if (!isNativeNotificationsAvailable()) {
    return { permission: "granted", native: false, pendingCount: 0 };
  }

  const settings = await loadReminderSettings();
  const permission = await LocalNotifications.checkPermissions();

  // 先无条件清干净:关掉开关、改了考期、今天做完了,都靠这一步生效
  await LocalNotifications.cancel({ notifications: JLPT_NOTIFICATION_IDS });

  if (!input || !settings.jlptReminder || permission.display !== "granted") {
    const pending = await LocalNotifications.getPending();
    return { permission: permission.display, native: true, pendingCount: pending.notifications.length };
  }

  const { hour, minute } = parseTime(settings.jlptTime);
  const now = new Date();
  const notifications = [];

  for (let offset = 0; offset < JLPT_NOTIFICATION_DAYS; offset += 1) {
    if (input.daysLeft - offset < 0) break;          // 考完了就不再排
    if (offset === 0 && input.todayClear) continue;   // 今天已经达标,不打扰
    const at = new Date(now);
    at.setDate(at.getDate() + offset);
    at.setHours(hour, minute, 0, 0);
    if (at.getTime() <= now.getTime()) continue;      // 今天这个点已经过了

    notifications.push({
      id: JLPT_NOTIFICATION_BASE_ID + offset,
      title: `${input.target} 备考计划`,
      body: jlptBodyFor(input, offset),
      schedule: { at },
      sound: settings.soundEnabled ? "" : undefined,
      threadIdentifier: "jlpt-plan",
      extra: { target: "word", jlpt: true }
    });
  }

  if (notifications.length > 0) {
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
      title: "收集日学习提醒",
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
