import { getDatabase } from "../database";
import { rowsFor } from "../database/db-utils";
import {
  buildWeeklyReport,
  getWeekWindow,
  passesThreshold,
  type WeeklyReport,
  type WeekWindow
} from "./weekly";

export const WEEKLY_REPORT_SCHEMA_VERSION = 3;
export const WEEKLY_REPORT_UPDATED_EVENT = "shushugo-weekly-report-updated";

export interface WeeklyReportSnapshot {
  schemaVersion: number;
  generatedAt: number;
  readAt: number | null;
  sourceRevision?: string;
  report: WeeklyReport;
}

const ensureWeeklyReportsTable = (): void => {
  getDatabase().run(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      week_start TEXT PRIMARY KEY,
      week_end TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 3,
      content_json TEXT NOT NULL,
      read_at INTEGER,
      source_revision TEXT,
      sync_updated_at TEXT,
      sync_origin_device TEXT
    )
  `);
  const columns = rowsFor("PRAGMA table_info(weekly_reports)").map((row) => String(row.name ?? ""));
  if (!columns.includes("source_revision")) getDatabase().run("ALTER TABLE weekly_reports ADD COLUMN source_revision TEXT");
  if (!columns.includes("sync_updated_at")) getDatabase().run("ALTER TABLE weekly_reports ADD COLUMN sync_updated_at TEXT");
  if (!columns.includes("sync_origin_device")) getDatabase().run("ALTER TABLE weekly_reports ADD COLUMN sync_origin_device TEXT");
};

const sourceRevision = (): string => {
  const parts: string[] = [];
  const tables: Array<[string, string]> = [
    ["reviews", "SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM reviews"],
    ["grammar_reviews", "SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM grammar_reviews"],
    ["grammar_activity_events", "SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM grammar_activity_events"],
    ["kanji_unit_reviews", "SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM kanji_unit_reviews"],
    ["word_study_time", "SELECT COUNT(*) count, COALESCE(SUM(seconds), 0) total FROM word_study_time"],
    ["study_time_by_period", "SELECT COUNT(*) count, COALESCE(SUM(seconds), 0) total FROM study_time_by_period"]
  ];
  for (const [table, query] of tables) {
    try {
      const row = rowsFor(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [table]).length
        ? rowsFor(query)[0]
        : null;
      parts.push(`${table}:${JSON.stringify(row ?? null)}`);
    } catch {
      parts.push(`${table}:null`);
    }
  }
  return parts.join("|");
};

const decode = (row: Record<string, unknown>): WeeklyReportSnapshot | null => {
  try {
    const parsed = JSON.parse(String(row.content_json ?? "")) as WeeklyReport;
    const report = normalizeWeeklyReport(parsed);
    if (!report?.window?.start || !report?.metrics) return null;
    return {
      schemaVersion: Number(row.schema_version ?? WEEKLY_REPORT_SCHEMA_VERSION),
      generatedAt: Number(row.generated_at ?? 0),
      readAt: row.read_at == null ? null : Number(row.read_at),
      sourceRevision: row.source_revision == null ? undefined : String(row.source_revision),
      report
    };
  } catch {
    // 一份损坏的周报不应阻止学习库打开；调用方会把它当作不可读历史。
    return null;
  }
};

const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const numberOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 把旧版把结束周日单独画成第八格的快照压回七格。 */
const normalizeDaily = (report: WeeklyReport): WeeklyReport["metrics"]["daily"] => {
  const raw = Array.isArray(report.metrics?.daily) ? report.metrics.daily : [];
  const daily = raw.map((day) => ({
    ...day,
    date: String(day.date ?? ""),
    reviews: numberOrZero(day.reviews),
    newWords: numberOrZero(day.newWords),
    seconds: numberOrZero(day.seconds)
  }));
  if (daily.length <= 7) return daily;

  const closingDay = localDateKey(new Date(report.window.endAt - 1));
  const firstIndex = daily.findIndex((day) => day.date === report.window.start);
  const closingIndex = daily.findIndex((day) => day.date === closingDay && day.date !== report.window.start);
  if (firstIndex >= 0 && closingIndex >= 0) {
    daily[firstIndex] = {
      ...daily[firstIndex],
      reviews: daily[firstIndex].reviews + daily[closingIndex].reviews,
      newWords: daily[firstIndex].newWords + daily[closingIndex].newWords,
      seconds: daily[firstIndex].seconds + daily[closingIndex].seconds
    };
    daily.splice(closingIndex, 1);
  }
  return daily.slice(0, 7);
};

const normalizeWeeklyReport = (report: WeeklyReport): WeeklyReport => {
  const daily = normalizeDaily(report);
  const rawDays = numberOrZero(report.metrics?.days);
  const highlight = report.highlight ?? null;
  const closingDay = localDateKey(new Date(report.window.endAt - 1));
  return {
    ...report,
    metrics: {
      ...report.metrics,
      // 一周最多七个展示日；旧快照可能在日格已被截断后仍残留 days=8。
      days: Math.min(Math.max(rawDays, 0), 7),
      daily
    },
    highlight: highlight && highlight.date === closingDay
      ? { ...highlight, date: report.window.start }
      : highlight,
    revisitWords: report.revisitWords ?? []
  };
};

export function getWeeklyReport(weekStart: string): WeeklyReportSnapshot | null {
  ensureWeeklyReportsTable();
  const row = rowsFor(
    "SELECT schema_version, generated_at, content_json, read_at, source_revision FROM weekly_reports WHERE week_start = ?",
    [weekStart]
  )[0];
  return row ? decode(row) : null;
}

export function listWeeklyReports(): WeeklyReportSnapshot[] {
  ensureWeeklyReportsTable();
  return rowsFor(
    "SELECT schema_version, generated_at, content_json, read_at, source_revision FROM weekly_reports ORDER BY week_start DESC"
  ).flatMap((row) => {
    const snapshot = decode(row);
    return snapshot ? [snapshot] : [];
  });
}

export function saveWeeklyReport(report: WeeklyReport, generatedAt = Date.now()): WeeklyReportSnapshot {
  ensureWeeklyReportsTable();
  const normalized = normalizeWeeklyReport(report);
  const existing = getWeeklyReport(normalized.window.start);
  const readAt = existing?.readAt ?? null;
  const revision = sourceRevision();
  getDatabase().run(`
    INSERT INTO weekly_reports
      (week_start, week_end, generated_at, schema_version, content_json, read_at, source_revision, sync_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(week_start) DO UPDATE SET
      week_end = excluded.week_end,
      generated_at = excluded.generated_at,
      schema_version = excluded.schema_version,
      content_json = excluded.content_json,
      read_at = excluded.read_at,
      source_revision = excluded.source_revision,
      sync_updated_at = excluded.sync_updated_at
  `, [
    normalized.window.start,
    normalized.window.end,
    generatedAt,
    WEEKLY_REPORT_SCHEMA_VERSION,
    JSON.stringify(normalized),
    readAt,
    revision,
    new Date().toISOString()
  ]);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WEEKLY_REPORT_UPDATED_EVENT));
  return {
    schemaVersion: WEEKLY_REPORT_SCHEMA_VERSION,
    generatedAt,
    readAt,
    sourceRevision: revision,
    report: normalized
  };
}

/**
 * 生成一个已结束的周期。相同周重复调用直接复用已有快照，避免重抽关键词。
 * 没有任何模式作答和时长时返回 null，不创建空周报。
 */
export function generateWeeklyReport(
  userSeed = "local",
  offset = 0,
  now: string | Date = new Date(),
  force = false
): WeeklyReportSnapshot | null {
  const window = getWeekWindow(now, offset);
  const existing = getWeeklyReport(window.start);
  // 云端补入记录时只重算尚未阅读的草稿；已经读过的快照保持原样。
  // 规则版本升级属于数据修正例外：旧版日格可能把一个周期画成八天，
  // 需要重算一次；重算仍保留 read_at，不会重新弹出已读提醒。
  if (existing && existing.schemaVersion >= WEEKLY_REPORT_SCHEMA_VERSION && (!force || existing.readAt != null)) return existing;
  const report = buildWeeklyReport(userSeed, offset, now);
  if (!passesThreshold(report.metrics)) return null;
  return saveWeeklyReport(report);
}

export function generateLatestWeeklyReport(
  userSeed = "local",
  now: string | Date = new Date(),
  force = false
): WeeklyReportSnapshot | null {
  return generateWeeklyReport(userSeed, 0, now, force);
}

export function markWeeklyReportRead(weekStart: string, readAt = Date.now()): boolean {
  ensureWeeklyReportsTable();
  const row = rowsFor("SELECT read_at FROM weekly_reports WHERE week_start = ? LIMIT 1", [weekStart])[0];
  if (!row || row.read_at != null) return false;
  getDatabase().run(
    "UPDATE weekly_reports SET read_at = ?, sync_updated_at = ? WHERE week_start = ?",
    [readAt, new Date().toISOString(), weekStart]
  );
  return true;
}

export interface WeeklyBackfillResult {
  generated: number;
  scanned: number;
  stoppedByLimit: boolean;
}

/** 单次补算的上限。补算是按需触发的，不做启动时全量扫描。 */
export const WEEKLY_BACKFILL_MAX_WEEKS = 12;
/** 连续这么多周没有任何学习记录，就认为再往前也没有，停止回溯。 */
const BACKFILL_EMPTY_STREAK_STOP = 3;

/**
 * 按需向上回溯生成缺失的历史周报。
 *
 * 只在受控的历史迁移或合并云端数据流程中调用；当前阅读页不暴露补算入口。
 * 单次最多扫描 maxWeeks 周，遇到连续空周即停，避免几周没打开时一次扫穿全部历史。
 */
export function backfillWeeklyReports(
  userSeed = "local",
  options: { maxWeeks?: number; now?: string | Date } = {}
): WeeklyBackfillResult {
  const maxWeeks = Math.max(1, Math.min(WEEKLY_BACKFILL_MAX_WEEKS, options.maxWeeks ?? 6));
  const now = options.now ?? new Date();
  let generated = 0;
  let scanned = 0;
  let emptyStreak = 0;
  for (let offset = 0; offset < maxWeeks; offset += 1) {
    const window = getWeekWindow(now, -offset);
    scanned += 1;
    if (getWeeklyReport(window.start)) {
      emptyStreak = 0;
      continue;
    }
    const report = buildWeeklyReport(userSeed, -offset, now);
    if (!passesThreshold(report.metrics)) {
      emptyStreak += 1;
      if (emptyStreak >= BACKFILL_EMPTY_STREAK_STOP) break;
      continue;
    }
    saveWeeklyReport(report);
    generated += 1;
    emptyStreak = 0;
  }
  return { generated, scanned, stoppedByLimit: scanned >= maxWeeks };
}

export type WeeklyReportNoticeState = "new" | "read" | "expired" | "none";

export interface WeeklyReportNotice {
  state: WeeklyReportNoticeState;
  weekStart: string | null;
}

/** 发布窗口：周日 14:00（发布）到周一 00:00，之后无条件恢复安静。 */
const NOTICE_WINDOW_MS = 10 * 60 * 60 * 1000;

/**
 * 站内更新提醒状态。只看最近一份报告：读过就不再提示，过期静默归档。
 * 不做未读红点，也不因为「没看不达标」催人。
 */
export function getWeeklyReportNotice(now: Date = new Date()): WeeklyReportNotice {
  const latest = listWeeklyReports()[0] ?? null;
  if (!latest) return { state: "none", weekStart: null };
  const weekStart = latest.report.window.start;
  if (latest.readAt != null) return { state: "read", weekStart };
  const publishedAt = latest.report.window.endAt;
  const at = now.getTime();
  if (!Number.isFinite(publishedAt) || at < publishedAt) return { state: "none", weekStart };
  if (at >= publishedAt + NOTICE_WINDOW_MS) return { state: "expired", weekStart };
  return { state: "new", weekStart };
}

/** 窗口结束边界（周日 14:00）对应的日期。 */
const windowEndDate = (window: WeekWindow): string => {
  const boundary = new Date(window.endAt);
  return `${boundary.getFullYear()}-${String(boundary.getMonth() + 1).padStart(2, "0")}-${String(boundary.getDate()).padStart(2, "0")}`;
};

export const reportWindowLabel = (window: WeekWindow): string => {
  const format = (value: string) => {
    const [, month, day] = value.split("-");
    return `${Number(month)} 月 ${Number(day)} 日`;
  };
  return `${format(window.start)} 14:00—${format(windowEndDate(window))} 14:00`;
};

/**
 * 历史列表用的紧凑标签：窄屏上一行放得下，不用把「9 月 6 日 14:00—9 月 13 日」
 * 折成两行。周期边界本身在楼层牌里仍然是完整写法。
 */
export const reportWindowLabelCompact = (window: WeekWindow): string => {
  const short = (value: string) => {
    const [, month, day] = value.split("-");
    return `${Number(month)}/${Number(day)}`;
  };
  return `${short(window.start)}—${short(windowEndDate(window))}`;
};
