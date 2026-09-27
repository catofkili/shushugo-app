import { collectDiagnostics, type DiagnosticsSnapshot } from "./diagnostics";
import { postFeedbackReport } from "./sync-api";

export type FeedbackKind = "feedback" | "error" | "hang" | "crash";

export interface SubmitFeedbackInput {
  kind: FeedbackKind;
  message: string;
  contact?: string;
  includeDiagnostics: boolean;
  diagnosticsSnapshot?: DiagnosticsSnapshot;
}

interface FeedbackPayload {
  kind: FeedbackKind;
  message: string;
  contact: string;
  platform: DiagnosticsSnapshot["platform"] | "unknown";
  app_version: string;
  route: string;
  diagnostics?: DiagnosticsSnapshot;
}

interface PendingFeedback {
  id: string;
  createdAt: number;
  payload: FeedbackPayload;
}

const PENDING_KEY = "mn-pending-feedback-reports";
const AUTO_SEND_KEY = "mn-feedback-auto-send-errors";
const ERROR_SEEN_KEY = "mn-feedback-error-signatures";
const LAST_PROMPT_KEY = "mn-feedback-last-prompt-at";
const RETENTION_MS = 180 * 24 * 60 * 60_000;
export interface ReportCandidate {
  kind: Exclude<FeedbackKind, "feedback">;
  message: string;
  diagnostics: DiagnosticsSnapshot;
}

const candidateListeners = new Set<(candidate: ReportCandidate) => void>();
let pendingCandidate: ReportCandidate | null = null;
export const subscribeReportCandidates = (listener: (candidate: ReportCandidate) => void): (() => void) => {
  candidateListeners.add(listener);
  if (pendingCandidate) {
    listener(pendingCandidate);
    pendingCandidate = null;
  }
  return () => candidateListeners.delete(listener);
};

const readPending = (): PendingFeedback[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const pending = parsed.filter((item) => item?.payload?.kind && typeof item.payload.message === "string"
      && Number.isFinite(item.createdAt) && now - item.createdAt <= RETENTION_MS) as PendingFeedback[];
    if (pending.length !== parsed.length) writePending(pending);
    return pending;
  } catch { return []; }
};

const writePending = (items: PendingFeedback[]): boolean => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(items.slice(-20)));
    return true;
  } catch { return false; }
};

export const getAutoSendErrors = (): boolean => {
  try { return localStorage.getItem(AUTO_SEND_KEY) === "true"; } catch { return false; }
};

export const setAutoSendErrors = (enabled: boolean): void => {
  try { localStorage.setItem(AUTO_SEND_KEY, String(enabled)); } catch { /* keep the current session usable */ }
}

const hashSignature = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
};

/** Once per matching error each day, and at most one prompt in any ten-minute window. */
export const claimErrorReport = (kind: FeedbackKind, message: string, route: string, now = Date.now()): boolean => {
  try {
    const stableMessage = kind === "hang" ? message.replace(/\d+(?:\.\d+)? 秒/g, "<duration>") : message;
    const signature = hashSignature(`${kind}\n${route}\n${stableMessage.slice(0, 500)}`);
    const seen = JSON.parse(localStorage.getItem(ERROR_SEEN_KEY) ?? "{}") as Record<string, number>;
    const lastAt = Number(seen[signature] ?? 0);
    if (now - lastAt < 24 * 60 * 60_000) return false;
    const lastPrompt = Number(localStorage.getItem(LAST_PROMPT_KEY) ?? 0);
    if (now - lastPrompt < 10 * 60_000) return false;
    localStorage.setItem(ERROR_SEEN_KEY, JSON.stringify({ ...seen, [signature]: now }));
    localStorage.setItem(LAST_PROMPT_KEY, String(now));
    return true;
  } catch { return true; }
};

const makePayload = (input: SubmitFeedbackInput): FeedbackPayload => {
  const diagnostics = input.includeDiagnostics ? input.diagnosticsSnapshot ?? collectDiagnostics() : undefined;
  return {
    kind: input.kind,
    message: Array.from(input.message.trim()).slice(0, 2_000).join(""),
    contact: Array.from(input.contact?.trim() ?? "").slice(0, 100).join(""),
    platform: diagnostics?.platform ?? "unknown",
    app_version: diagnostics?.appVersion ?? "",
    route: diagnostics?.route ?? "",
    ...(diagnostics ? { diagnostics } : {})
  };
};

const remember = (payload: FeedbackPayload): boolean => writePending([
  ...readPending(),
  { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), payload }
]);

export type FeedbackDelivery = "sent" | "queued";

export const submitFeedback = async (input: SubmitFeedbackInput): Promise<FeedbackDelivery> => {
  const payload = makePayload(input);
  try {
    await postFeedbackReport(payload);
    return "sent";
  } catch {
    if (!remember(payload)) throw new Error("暂时无法发送，且本机没有足够空间保存这条意见。");
    return "queued";
  }
};

let flushInFlight: Promise<void> | null = null;
export const flushPendingFeedback = (): Promise<void> => {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    const pending = readPending();
    for (let index = 0; index < pending.length; index += 1) {
      try {
        await postFeedbackReport(pending[index].payload);
        if (!writePending(pending.slice(index + 1))) return;
      } catch { return; }
    }
  })().finally(() => { flushInFlight = null; });
  return flushInFlight;
};

export const emitReportCandidate = (candidate: ReportCandidate): void => {
  if (candidateListeners.size === 0) {
    pendingCandidate = candidate;
    return;
  }
  candidateListeners.forEach((listener) => listener(candidate));
};
