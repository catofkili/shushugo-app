import { useEffect, useState } from "react";
import { MascotSay } from "./MascotSay";
import { ScrollArea } from "./ScrollArea";
import { getAutoSendErrors, setAutoSendErrors, submitFeedback, subscribeReportCandidates, type ReportCandidate } from "../lib/feedback";

const reportMessage = (candidate: ReportCandidate, addition: string) => (
  addition.trim() ? `${candidate.message}\n\n补充：${addition.trim()}` : candidate.message
);

export function ReportPrompt() {
  const [candidate, setCandidate] = useState<ReportCandidate | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [addition, setAddition] = useState("");
  const [autoSend, setAutoSend] = useState(getAutoSendErrors);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"sent" | "queued" | "failed" | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeReportCandidates((next) => {
      setCandidate(next);
      setExpanded(false);
      setAddition("");
      setAutoSend(getAutoSendErrors());
      setResult(null);
    });
    return unsubscribe;
  }, []);

  if (!candidate) return null;

  const dismiss = () => { setCandidate(null); setExpanded(false); setResult(null); };
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

  const summary = candidate.kind === "hang" ? "主线程刚才卡住了" : candidate.kind === "crash" ? "上次运行中断了" : "应用刚才遇到了错误";

  return (
    <div className="pointer-events-none fixed left-3 right-3 z-[10002] sm:left-auto sm:right-5 sm:w-[min(25rem,calc(100vw-2.5rem))]" style={{ bottom: "calc(var(--app-main-bottom, 4.5rem) + 0.5rem)" }}>
      <section className="pointer-events-auto rounded-2xl bg-[var(--ds-surface)] shadow-xl ring-1 ring-black/10">
        {!expanded && !result ? (
          <div className="flex min-h-10 items-center gap-2 px-2 py-1">
            <button type="button" onClick={() => setExpanded(true)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-[var(--ds-ink)]">
              {summary} · 点击查看
            </button>
            <button type="button" onClick={dismiss} aria-label="关闭问题提示" title="关闭" className="ds-btn-soft shrink-0 rounded-full text-2xl leading-none" style={{ width: 36, height: 36, minHeight: 36, padding: 0 }}>×</button>
          </div>
        ) : (
          <ScrollArea className="p-3" style={{ maxHeight: "calc(100vh - var(--app-main-top) - var(--app-main-bottom) - 1.5rem)" }}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {result ? (
                  <MascotSay sticker={result === "failed" ? "mood-puzzled" : "mood-yay"} tone={result === "failed" ? "warn" : "good"} size={42}>
                    {result === "sent" ? "收到啦，谢谢你。" : result === "queued" ? "已保存，联网后自动发送。" : "保存失败，请稍后重试。"}
                  </MascotSay>
                ) : (
                  <MascotSay sticker="mood-dizzy" tone="warn" size={42}>
                    {candidate.kind === "hang" ? `${candidate.message.replace(/[。.!?？]+$/, "")}，要把诊断信息发给开发者吗？` : "应用刚才遇到一个错误，要把诊断信息发给开发者吗？"}
                  </MascotSay>
                )}
              </div>
              <button type="button" onClick={dismiss} aria-label="关闭问题提示" title="关闭" className="ds-btn-soft shrink-0 rounded-full text-2xl leading-none" style={{ width: 36, height: 36, minHeight: 36, padding: 0 }}>×</button>
            </div>
            {result ? null : (
              <>
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
          </ScrollArea>
        )}
      </section>
    </div>
  );
}
