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

const issueReport = (kind: Exclude<FeedbackKind, "feedback">, message: string): void => {
  const diagnostics = collectDiagnostics();
  if (!claimErrorReport(kind, message, diagnostics.route)) return;
  if (getAutoSendErrors()) {
    void submitFeedback({ kind, message, includeDiagnostics: true, diagnosticsSnapshot: diagnostics }).catch(() => undefined);
  } else {
    emitReportCandidate({ kind, message, diagnostics });
  }
};

export const captureRuntimeError = (error: unknown): void => {
  const saved = recordDiagnosticError(error);
  issueReport("error", saved.message);
};

export const startFeedbackRuntimeCore = (bindings: RuntimeBindings): (() => void) => {
  if (started) return () => undefined;
  started = true;
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
      issueReport("crash", `上次运行未正常结束（最后心跳距今 ${Math.max(1, Math.round((now() - previous.lastHeartbeatAt) / 1_000))} 秒）。`);
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
