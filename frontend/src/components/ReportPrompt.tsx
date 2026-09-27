import { useEffect, useState } from "react";
import { MascotSay } from "./MascotSay";
import { getAutoSendErrors, setAutoSendErrors, submitFeedback, subscribeReportCandidates, type ReportCandidate } from "../lib/feedback";

const reportMessage = (candidate: ReportCandidate, addition: string) => (
  addition.trim() ? `${candidate.message}\n\n补充：${addition.trim()}` : candidate.message
);

export function ReportPrompt() {
  const [candidate, setCandidate] = useState<ReportCandidate | null>(null);
  const [addition, setAddition] = useState("");
  const [autoSend, setAutoSend] = useState(getAutoSendErrors);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"sent" | "queued" | "failed" | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeReportCandidates((next) => {
      setCandidate(next);
      setAddition("");
      setAutoSend(getAutoSendErrors());
      setResult(null);
    });
    return unsubscribe;
  }, []);

  if (!candidate) return null;

  const dismiss = () => { setCandidate(null); setResult(null); };
  const setAuto = (enabled: boolean) => {
    setAutoSend(enabled);
    setAutoSendErrors(enabled);
  };
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setResult(await submitFeedback({
        kind: candidate.kind,
        message: reportMessage(candidate, addition),
        includeDiagnostics: true,
        diagnosticsSnapshot: candidate.diagnostics
      }));
    } catch {
      setResult("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-none fixed left-3 right-3 z-[10002] sm:left-auto sm:right-5 sm:w-[min(25rem,calc(100vw-2.5rem))]" style={{ top: "calc(var(--app-main-top, 4.5rem) + 0.5rem)" }}>
      <section className="pointer-events-auto rounded-2xl bg-[var(--ds-surface)] p-3 shadow-xl ring-1 ring-black/10">
        {result ? (
          <>
            <MascotSay sticker={result === "failed" ? "mood-puzzled" : "mood-yay"} tone={result === "failed" ? "warn" : "good"} size={42}>
              {result === "sent" ? "收到啦，谢谢你。" : result === "queued" ? "已保存，联网后自动发送。" : "保存失败，请稍后重试。"}
            </MascotSay>
            <button type="button" onClick={dismiss} className="ds-btn-soft mt-2 w-full rounded-xl px-3 py-2 text-sm">关闭</button>
          </>
        ) : (
          <>
            <MascotSay sticker="mood-dizzy" tone="warn" size={42}>
              {candidate.kind === "hang" ? `${candidate.message.replace(/[。.!?？]+$/, "")}，要把诊断信息发给开发者吗？` : candidate.kind === "crash" ? "上次运行似乎没有正常结束，要把诊断信息发给开发者吗？" : "应用刚才遇到一个错误，要把诊断信息发给开发者吗？"}
            </MascotSay>
            <textarea
              aria-label="想补充点什么（可不填）"
              value={addition}
              onChange={(event) => setAddition(event.target.value)}
              maxLength={500}
              rows={2}
              className="mt-2 block w-full resize-none rounded-xl bg-[var(--ds-inset)] px-3 py-2 text-sm text-[var(--ds-ink)] placeholder:text-[var(--ds-ink-3)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-primary)]"
              placeholder="想补充点什么（可不填）"
            />
            <label className="mt-2 flex items-center gap-2 px-1 text-xs text-[var(--ds-ink-2)]">
              <input type="checkbox" checked={autoSend} onChange={(event) => setAuto(event.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />
              以后自动发送，不再询问
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => void send()} className="ds-btn rounded-xl px-3 py-2 text-sm font-bold">{busy ? "发送中…" : "发送"}</button>
              <button type="button" onClick={dismiss} className="ds-btn-soft rounded-xl px-3 py-2 text-sm font-bold">不用了</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
