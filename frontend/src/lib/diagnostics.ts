import { Capacitor } from "@capacitor/core";
import { perfPhases } from "./perf-marks";

const ERROR_KEY = "mn-feedback-recent-errors";
const ROUTE_KEY = "mn-feedback-recent-routes";
const RUN_KEY = "mn-feedback-running";
const RETENTION_MS = 180 * 24 * 60 * 60_000;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_RE = /Bearer\s+[^\s"']+/gi;

export interface DiagnosticError {
  message: string;
  stack: string;
}

export interface DiagnosticRoute {
  page: string;
  at: number;
}

export interface DiagnosticRunningMarker {
  startedAt: number;
  lastHeartbeatAt: number;
  page: string;
  lastOperation: string;
}

export interface DiagnosticsSnapshot {
  appVersion: string;
  platform: "web" | "ios" | "wechat";
  system: { name: string; version: string };
  wechatBaseLibraryVersion?: string;
  route: string;
  recentErrors: DiagnosticError[];
  perfMarks: Array<{ phase: string; recentMs: number[] }>;
  recentRoutes: DiagnosticRoute[];
  lastOperation: string;
}

let currentRoute = "unknown";
let lastOperation = "打开应用";

const safeStorage = {
  get(key: string): string | null {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  },
  set(key: string, value: string): void {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* diagnostics must not affect study */ }
  },
  remove(key: string): void {
    try { globalThis.localStorage?.removeItem(key); } catch { /* diagnostics must not affect study */ }
  }
};

const safeText = (value: string, maxBytes: number): string => {
  const text = value.replace(EMAIL_RE, "[email]").replace(BEARER_RE, "Bearer [redacted]").replace(/[\u0000-\u001f\u007f]/g, " ");
  let result = "";
  let bytes = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const size = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + size > maxBytes) break;
    result += char;
    bytes += size;
  }
  return result;
};

const readArray = <T>(key: string): T[] => {
  try {
    const parsed: unknown = JSON.parse(safeStorage.get(key) ?? "[]");
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch { return []; }
};

interface StoredDiagnosticError extends DiagnosticError { at: number }

const readStoredErrors = (): StoredDiagnosticError[] => readArray<unknown>(ERROR_KEY).slice(-20).flatMap((value) => {
  if (!value || typeof value !== "object") return [];
  const error = value as Record<string, unknown>;
  if (!Number.isFinite(error.at) || Date.now() - Number(error.at) > RETENTION_MS) return [];
  return [{
    message: safeText(typeof error.message === "string" ? error.message : "运行错误", 256),
    stack: safeText(typeof error.stack === "string" ? error.stack : "", 768),
    at: Number(error.at)
  }];
});

const readRecentRoutes = (): DiagnosticRoute[] => readArray<unknown>(ROUTE_KEY).slice(-10).flatMap((value) => {
  if (!value || typeof value !== "object") return [];
  const route = value as Record<string, unknown>;
  if (typeof route.page !== "string" || !/^[a-z0-9-]{1,48}$/i.test(route.page) || !Number.isFinite(route.at)
    || Date.now() - Number(route.at) > RETENTION_MS) return [];
  return [{ page: route.page, at: Number(route.at) }];
});

export const recordDiagnosticRoute = (page: string, at = Date.now()): void => {
  const safePage = /^[a-z0-9-]{1,48}$/i.test(page) ? page : "unknown";
  currentRoute = safePage;
  const routes = readRecentRoutes();
  if (routes[routes.length - 1]?.page !== safePage) {
    routes.push({ page: safePage, at });
    safeStorage.set(ROUTE_KEY, JSON.stringify(routes.slice(-10)));
    lastOperation = `打开 ${safePage}`;
  }
};

export const recordDiagnosticOperation = (operation: string): void => {
  lastOperation = safeText(operation, 80);
};

export const recordDiagnosticError = (error: unknown): DiagnosticError => {
  const item = error instanceof Error
    ? { message: safeText(error.message || error.name || "运行错误", 256), stack: safeText(error.stack ?? "", 768) }
    : { message: "未处理的运行错误", stack: "" };
  const errors = [...readStoredErrors(), { ...item, at: Date.now() }].slice(-20);
  safeStorage.set(ERROR_KEY, JSON.stringify(errors));
  return item;
};

const systemInfo = (): { name: string; version: string; baseLibraryVersion?: string } => {
  const mini = (globalThis as typeof globalThis & {
    wx?: { getSystemInfoSync?: () => { system?: string; SDKVersion?: string } }
  }).wx;
  try {
    const info = mini?.getSystemInfoSync?.();
    if (info) {
      const [name = "unknown", ...version] = String(info.system ?? "").split(" ");
      return { name, version: version.join(" ") || "unknown", baseLibraryVersion: info.SDKVersion };
    }
  } catch { /* fall back to the user agent */ }

  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const ios = ua.match(/(?:iPhone|iPad|iPod).*?OS ([\d_]+)/i);
  const android = ua.match(/Android ([\d.]+)/i);
  if (ios) return { name: "iOS", version: ios[1].replace(/_/g, ".") };
  if (android) return { name: "Android", version: android[1] };
  return { name: "unknown", version: "unknown" };
};

export const collectDiagnostics = (): DiagnosticsSnapshot => {
  const platform = Capacitor.getPlatform();
  const system = systemInfo();
  const version = (globalThis as typeof globalThis & { __APP_VERSION__?: string }).__APP_VERSION__;
  const recentErrors = readStoredErrors();
  safeStorage.set(ERROR_KEY, JSON.stringify(recentErrors));
  const recentRoutes = readRecentRoutes();
  safeStorage.set(ROUTE_KEY, JSON.stringify(recentRoutes));
  return {
    appVersion: typeof version === "string" ? version : "unknown",
    platform: platform === "wechat" ? "wechat" : platform === "ios" ? "ios" : "web",
    system: { name: system.name, version: system.version },
    ...(system.baseLibraryVersion ? { wechatBaseLibraryVersion: system.baseLibraryVersion } : {}),
    route: currentRoute,
    recentErrors: recentErrors.map(({ message, stack }) => ({ message, stack })),
    perfMarks: [...perfPhases.entries()].slice(-20).map(([phase, values]) => ({ phase: safeText(phase, 80), recentMs: values.slice(-20) })),
    recentRoutes,
    lastOperation
  };
};

export const getDiagnosticActivity = () => ({ page: currentRoute, lastOperation });

export const saveRunningMarker = (marker: DiagnosticRunningMarker): void => {
  safeStorage.set(RUN_KEY, JSON.stringify(marker));
};

export const readRunningMarker = (): DiagnosticRunningMarker | null => {
  try {
    const marker = JSON.parse(safeStorage.get(RUN_KEY) ?? "null") as Partial<DiagnosticRunningMarker> | null;
    if (!marker || !Number.isFinite(marker.startedAt) || !Number.isFinite(marker.lastHeartbeatAt)) return null;
    if (Date.now() - Number(marker.lastHeartbeatAt) > RETENTION_MS) {
      safeStorage.remove(RUN_KEY);
      return null;
    }
    return {
      startedAt: Number(marker.startedAt),
      lastHeartbeatAt: Number(marker.lastHeartbeatAt),
      page: typeof marker.page === "string" ? marker.page : "unknown",
      lastOperation: typeof marker.lastOperation === "string" ? safeText(marker.lastOperation, 80) : "未知操作"
    };
  } catch { return null; }
};

export const clearRunningMarker = (): void => safeStorage.remove(RUN_KEY);

export const restoreDiagnosticActivity = (marker: DiagnosticRunningMarker): void => {
  currentRoute = marker.page;
  lastOperation = marker.lastOperation;
};
