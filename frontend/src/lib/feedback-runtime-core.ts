import {
  clearRunningMarker,
  collectDiagnostics,
  getDiagnosticActivity,
  readRunningMarker,
  recordDiagnosticError,
  recordDiagnosticOperation,
  restoreDiagnosticActivity,
  saveRunningMarker
} from "./diagnostics";
import { startHangWatchdog, type VisibilityEvent } from "./hang-watchdog";
import { claimErrorReport, emitReportCandidate, flushPendingFeedback, getAutoSendErrors, submitFeedback, type FeedbackKind } from "./feedback";

interface RuntimeBindings {
  bindErrors: (onError: (error: Error) => void) => () => void;
  subscribeVisibility: (listener: (event: VisibilityEvent) => void) => () => void;
  isVisible: () => boolean;
  subscribeOnline?: (listener: () => void) => () => void;
  now?: () => number;
}

let started = false;
let startupCrashChecked = false;
let promptedKinds = new Set<"error" | "hang">();

const RECOVERABLE_ERROR = /failed to f[a-z]tch|network(?:error| request failed)|load failed|request (?:failed|timed out)|audio|speech|voice|playback|abort(?:ed)?|cancel(?:led|ed)?|interrupt(?:ed)?|resource|asset|资源加载|加载失败|音频|读音|播放|音色|云端|网络请求|打断/i;

export const isRecoverableRuntimeError = (error: unknown): boolean => {
  if (error instanceof Error && error.name === "AbortError") return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return RECOVERABLE_ERROR.test(message);
};

const issueReport = (kind: Exclude<FeedbackKind, "feedback">, message: string): void => {
  const autoSend = getAutoSendErrors();
  if (!autoSend && (kind === "error" || kind === "hang") && promptedKinds.has(kind)) return;
  const diagnostics = collectDiagnostics();
  if (!claimErrorReport(kind, message, diagnostics.route)) return;
  if (autoSend) {
    void submitFeedback({ kind, message, includeDiagnostics: true, diagnosticsSnapshot: diagnostics }).catch(() => undefined);
  } else {
    if (kind === "error" || kind === "hang") promptedKinds.add(kind);
    emitReportCandidate({ kind, message, diagnostics });
  }
};

export const captureRuntimeError = (error: unknown): void => {
  const saved = recordDiagnosticError(error);
  if (!isRecoverableRuntimeError(error)) issueReport("error", saved.message);
};

export const startFeedbackRuntimeCore = (bindings: RuntimeBindings): (() => void) => {
  if (started) return () => undefined;
  started = true;
  promptedKinds = new Set();
  const now = bindings.now ?? Date.now;
  let lastHeartbeatAt = now();
  let sessionStartedAt = lastHeartbeatAt;

  const beginSession = () => {
    sessionStartedAt = now();
    lastHeartbeatAt = sessionStartedAt;
    const activity = getDiagnosticActivity();
    saveRunningMarker({ startedAt: sessionStartedAt, lastHeartbeatAt, ...activity });
  };

  if (!startupCrashChecked) {
    startupCrashChecked = true;
    const previous = readRunningMarker();
    if (previous) {
      restoreDiagnosticActivity(previous);
      recordDiagnosticError(new Error(`上次运行未正常结束（最后心跳距今 ${Math.max(1, Math.round((now() - previous.lastHeartbeatAt) / 1_000))} 秒）；中断原因无法确认。`));
    }
  }
  if (bindings.isVisible()) beginSession();

  const stopErrors = bindings.bindErrors(captureRuntimeError);
  const stopWatchdog = startHangWatchdog({
    now,
    isVisible: bindings.isVisible,
    subscribeVisibility: bindings.subscribeVisibility,
    onVisibility(event) {
      if (event.visible) {
        recordDiagnosticOperation("回到前台");
        beginSession();
      } else {
        clearRunningMarker();
      }
    },
    onHeartbeat(at) { lastHeartbeatAt = at; },
    onHang(event) { issueReport("hang", `刚才卡住了 ${Math.max(1, Math.round(event.durationMs / 1_000))} 秒。`); }
  });
  const stopOnline = bindings.subscribeOnline?.(() => { void flushPendingFeedback(); }) ?? (() => undefined);
  const markerTimer = setInterval(() => {
    if (!bindings.isVisible()) return;
    const activity = getDiagnosticActivity();
    saveRunningMarker({ startedAt: sessionStartedAt, lastHeartbeatAt, ...activity });
  }, 5_000);
  void flushPendingFeedback();

  return () => {
    started = false;
    clearInterval(markerTimer);
    stopErrors();
    stopWatchdog();
    stopOnline();
  };
};

export const foregroundEvent = (visible: boolean, at = Date.now()): VisibilityEvent => ({ at, visible });
