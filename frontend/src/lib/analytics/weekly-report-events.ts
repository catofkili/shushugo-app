/**
 * 周报的本地观测台账。
 *
 * 计划要求「先确定事件、分母、版本和去重方式」，并且**不默认上传**：
 * 现有隐私说明不覆盖这类采集时，先用本地诊断和自愿反馈。
 * 所以这里只写本机 app_state，不联网、不进云快照，键名登记在
 * `DEVICE_LOCAL_STATE_KEYS` 里，避免被对端账号的同类记录覆盖。
 *
 * 记录内容刻意只有阶段、入口、周标识和客户端版本，不含正文、词条或答案。
 */

import { getState, setState } from "../database/db-utils";

export const WEEKLY_REPORT_EVENTS_KEY = "weekly_report_events";

export type WeeklyReportEventKind =
  | "available"
  | "opened"
  | "completed"
  | "review_added"
  | "failed";

export type WeeklyReportEntry = "button" | "pull" | "notification";

export interface WeeklyReportEvent {
  kind: WeeklyReportEventKind;
  /** 报告标识（周期首日），作为分母和去重粒度 */
  weekStart: string;
  at: number;
  entry?: WeeklyReportEntry;
  /** 失败或阶段标记，只写枚举值，不写错误正文 */
  stage?: string;
}

/** 台账长度上限。它只是本地诊断，不追求长期留存。 */
const MAX_EVENTS = 200;

const isEvent = (value: unknown): value is WeeklyReportEvent => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WeeklyReportEvent>;
  return typeof item.kind === "string" && typeof item.weekStart === "string" && typeof item.at === "number";
};

const dedupeKey = (event: WeeklyReportEvent): string =>
  [event.kind, event.weekStart, event.entry ?? "", event.stage ?? ""].join("|");

export function listWeeklyReportEvents(): WeeklyReportEvent[] {
  try {
    const raw = getState(WEEKLY_REPORT_EVENTS_KEY, "");
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEvent);
  } catch {
    // 诊断台账损坏不该影响任何功能。
    return [];
  }
}

/**
 * 记一条事件。同一份报告的同类事件只记一次（可按入口区分），
 * 所以 React 重挂载、返回前台、重复点击都不会把数字刷大。
 */
export function recordWeeklyReportEvent(event: WeeklyReportEvent): void {
  if (!event.weekStart) return;
  try {
    const events = listWeeklyReportEvents();
    const key = dedupeKey(event);
    if (events.some((item) => dedupeKey(item) === key)) return;
    const next = [...events, event].slice(-MAX_EVENTS);
    setState(WEEKLY_REPORT_EVENTS_KEY, JSON.stringify(next));
  } catch {
    // 记账失败不阻断阅读。
  }
}

/** 本地诊断用的计数，按事件种类汇总。 */
export function weeklyReportEventCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of listWeeklyReportEvents()) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}
