import { Capacitor } from "@capacitor/core";
import { LocalNotifications, type PermissionStatus } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { generateLatestWeeklyReport } from "./analytics/weekly-reports";
import { getWeekWindow, getWeeklyMetrics, passesThreshold } from "./analytics/weekly";

export interface ReminderSettings {
  studyReminder: boolean;
  reviewReminder: boolean;
  achievementNotif: boolean;
  soundEnabled: boolean;
  studyTime: string;
  reviewTime: string;
  /** 每周学习回顾通知：只在生成成功且处于周日 14:00–14:30 时排期 */
  weeklyReportReminder: boolean;
  /** 备考计划提醒:每天播报「今天最少还要做多少」才不掉队 */
  jlptReminder: boolean;
  jlptTime: string;
}

export interface ReminderSyncResult {
  permission: PermissionStatus["display"];
  native: boolean;
  pendingCount: number;
  /** 当前周期还没有学习记录时，前台轮询需要稍后再检查。 */
  retryWeeklyReportSoon?: boolean;
}

const SETTINGS_KEY = "mn_notification_settings";
const STUDY_NOTIFICATION_ID = 9101;
const REVIEW_NOTIFICATION_ID = 9102;
// ⚠️ 成就通知的 id 是 base + Date.now() % 100,占 9200–9299 这一段,**不许再放宽**:
// 原来是 % 1000,范围 9200–10199,把测试通知(9301)和备考提醒(9400–9413)整段吃掉了 ——
// 一次成就解锁就可能顶掉当天的备考提醒,或者反过来被它取消。
const ACHIEVEMENT_NOTIFICATION_BASE_ID = 9200;
const ACHIEVEMENT_NOTIFICATION_SLOTS = 100;
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

// 周报通知单独占一个 ID，不与每日提醒、成就和备考提醒重叠。
const WEEKLY_REPORT_NOTIFICATION_ID = 9501;
export const WEEKLY_REPORT_NOTIFICATION_EVENT = "weekly-report-notification";
let pendingWeeklyReportWeekStart: string | null = null;
let notificationActionListenerRegistered = false;

export const defaultReminderSettings: ReminderSettings = {
  studyReminder: true,
  reviewReminder: true,
  achievementNotif: true,
  soundEnabled: true,
  studyTime: "09:00",
  reviewTime: "20:00",
  weeklyReportReminder: true,
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
  // 周报通知有独立的一次性排期，不能让它把空数组传给每日提醒的 schedule。
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
 * 周日 14:30 的一次性周报通知。
 *
 * 本地通知不能在 App 完全未启动时读取 SQLite；有本周期记录时会提前排好
 * 14:30 的一次性通知，点击冷启动后再生成最终快照。14:30 之后不补发，避免
 * 周一打开时突然打扰用户。
 */
export async function syncWeeklyReportNotification(
  settings: ReminderSettings,
  requestPermission = false,
  now = new Date()
): Promise<ReminderSyncResult> {
  if (!isNativeNotificationsAvailable()) {
    return { permission: "granted", native: false, pendingCount: 0 };
  }

  let permission = await LocalNotifications.checkPermissions();
  if (settings.weeklyReportReminder && permission.display !== "granted" && requestPermission) {
    permission = await LocalNotifications.requestPermissions();
  }

  await LocalNotifications.cancel({ notifications: [{ id: WEEKLY_REPORT_NOTIFICATION_ID }] });
  const current = new Date(now);
  const isSunday = current.getDay() === 0;
  const fourteen = new Date(current);
  fourteen.setHours(14, 0, 0, 0);
  const fourteenThirty = new Date(current);
  fourteenThirty.setHours(14, 30, 0, 0);
  const withinWindow = current.getTime() >= fourteen.getTime() && current.getTime() < fourteenThirty.getTime();

  let retryWeeklyReportSoon = false;
  if (settings.weeklyReportReminder && permission.display === "granted" && isSunday && withinWindow) {
    const snapshot = generateLatestWeeklyReport("local", current);
    const weekStart = snapshot?.report.window.start;
    // 用户可能已经从主页打开并读完这份周报；这种情况下不应因为下一次
    // 前台同步又把同一条 14:30 提醒排回来。
    if (snapshot && weekStart && snapshot.readAt == null) {
      const { requestFullSnapshot, saveDatabase } = await import("./storage");
      requestFullSnapshot();
      await saveDatabase();
      await LocalNotifications.schedule({
        notifications: [{
          id: WEEKLY_REPORT_NOTIFICATION_ID,
          title: "这一周的学习回顾到了",
          body: "打开看看，这段时间你和日语见过面。",
          schedule: { at: fourteenThirty },
          sound: settings.soundEnabled ? "" : undefined,
          threadIdentifier: "weekly-report",
          extra: { target: "weekly-report", weekStart }
        }]
      });
    } else {
      retryWeeklyReportSoon = true;
    }
  } else if (settings.weeklyReportReminder && permission.display === "granted") {
    // App 可能在周日 14:00 后被系统挂起，无法在后台执行 JS。只要当前周期
    // 已有学习记录，先排好 14:30 的通知；点击时冷启动会再生成最终快照。
    const delivery = new Date(current);
    const daysUntilSunday = (7 - delivery.getDay()) % 7;
    delivery.setDate(delivery.getDate() + daysUntilSunday);
    delivery.setHours(14, 30, 0, 0);
    if (delivery.getTime() <= current.getTime()) delivery.setDate(delivery.getDate() + 7);
    const upcomingWindow = getWeekWindow(delivery);
    if (passesThreshold(getWeeklyMetrics(upcomingWindow))) {
      await LocalNotifications.schedule({
        notifications: [{
          id: WEEKLY_REPORT_NOTIFICATION_ID,
          title: "这一周的学习回顾到了",
          body: "打开看看，这段时间你和日语见过面。",
          schedule: { at: delivery },
          sound: settings.soundEnabled ? "" : undefined,
          threadIdentifier: "weekly-report",
          extra: { target: "weekly-report", weekStart: upcomingWindow.start }
        }]
      });
    } else {
      retryWeeklyReportSoon = true;
    }
  }

  const pending = await LocalNotifications.getPending();
  return { permission: permission.display, native: true, pendingCount: pending.notifications.length, retryWeeklyReportSoon };
}

/** 读完最新周报后撤掉尚未送达的那一条通知。 */
export async function cancelWeeklyReportNotification(): Promise<void> {
  if (!isNativeNotificationsAvailable()) return;
  await LocalNotifications.cancel({ notifications: [{ id: WEEKLY_REPORT_NOTIFICATION_ID }] });
}

export async function autoSyncWeeklyReportNotification(now = new Date()): Promise<ReminderSyncResult> {
  const settings = await loadReminderSettings();
  const permission = await checkReminderPermission();
  if (!permission.native || permission.permission !== "granted") return permission;
  return syncWeeklyReportNotification(settings, false, now);
}

/** 注册通知点击监听。pending 值让冷启动时 App 尚未挂载也不会丢失跳转。 */
export async function registerNotificationActionListener(): Promise<void> {
  if (!isNativeNotificationsAvailable() || notificationActionListenerRegistered) return;
  notificationActionListenerRegistered = true;
  await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const extra = action.notification.extra as { target?: string; weekStart?: string } | undefined;
    if (extra?.target !== "weekly-report") return;
    pendingWeeklyReportWeekStart = typeof extra.weekStart === "string" ? extra.weekStart : null;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(WEEKLY_REPORT_NOTIFICATION_EVENT, {
        detail: { weekStart: pendingWeeklyReportWeekStart }
      }));
    }
  });
}

export function consumePendingWeeklyReportWeekStart(): string | null {
  const value = pendingWeeklyReportWeekStart;
  pendingWeeklyReportWeekStart = null;
  return value;
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
      id: ACHIEVEMENT_NOTIFICATION_BASE_ID + Math.floor(Date.now() % ACHIEVEMENT_NOTIFICATION_SLOTS),
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
