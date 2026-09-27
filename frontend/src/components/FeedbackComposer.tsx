import { useState } from "react";
import { MascotSay } from "./MascotSay";
import { ScrollArea } from "./ScrollArea";
import { submitFeedback } from "../lib/feedback";

export function FeedbackComposer({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"sent" | "queued" | "failed" | null>(null);

  const send = async () => {
    if (message.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      setResult(await submitFeedback({ kind: "feedback", message, contact, includeDiagnostics }));
    } catch {
      setResult("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10003] flex items-end bg-black/55" role="presentation" onClick={onClose}>
      <ScrollArea
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="max-h-[88vh] w-full rounded-t-[1.75rem] bg-[var(--ds-surface)] px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-5 text-[var(--ds-ink)] shadow-2xl sm:mx-auto sm:max-w-xl sm:rounded-[1.75rem] sm:mb-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--ds-line)] sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="feedback-title" className="text-lg font-bold">提意见 / 报问题</h2>
            <p className="mt-1 text-sm text-[var(--ds-ink-2)]">不需要登录，写下你希望我们知道的事。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="ds-btn-soft rounded-xl px-3 py-2 text-sm">关闭</button>
        </div>

        {result ? (
          <div className="mt-5">
            {result === "sent" && <MascotSay sticker="mood-yay" tone="good">收到啦，谢谢你。</MascotSay>}
            {result === "queued" && <MascotSay sticker="mood-wave">已保存，联网后自动发送。</MascotSay>}
            {result === "failed" && <MascotSay sticker="mood-puzzled" tone="warn">这次没有保存成功，请复制内容后再试一次。</MascotSay>}
            <button type="button" onClick={onClose} className="ds-btn mt-5 w-full rounded-2xl px-4 py-3 font-bold">完成</button>
          </div>
        ) : (
          <>
            <label htmlFor="feedback-message" className="mt-5 block text-sm font-bold">想告诉我们什么</label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2_000}
              rows={5}
              className="mt-2 block min-h-32 w-full resize-y rounded-2xl bg-[var(--ds-inset)] px-4 py-3 text-base text-[var(--ds-ink)] placeholder:text-[var(--ds-ink-3)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-primary)]"
              placeholder="哪里不好用、想要什么功能，直接告诉我们"
            />
            <label htmlFor="feedback-contact" className="mt-4 block text-sm font-bold">联系方式 <span className="font-normal text-[var(--ds-ink-3)]">（可不填）</span></label>
            <input
              id="feedback-contact"
              type="text"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              maxLength={100}
              className="mt-2 block w-full rounded-2xl bg-[var(--ds-inset)] px-4 py-3 text-base text-[var(--ds-ink)] placeholder:text-[var(--ds-ink-3)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-primary)]"
              placeholder="微信号或手机号，方便我们回复你（可不填）"
            />
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-[var(--ds-inset)] p-3 text-sm">
              <input type="checkbox" checked={includeDiagnostics} onChange={(event) => setIncludeDiagnostics(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ds-primary)]" />
              <span><span className="block font-bold">附带诊断信息</span><span className="mt-0.5 block text-xs text-[var(--ds-ink-3)]">版本、设备与最近错误，不含学习内容</span></span>
            </label>
            <button type="button" disabled={busy || message.trim().length < 2} onClick={() => void send()} className="ds-btn mt-5 w-full rounded-2xl px-4 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-45">
              {busy ? "正在发送…" : "发送"}
            </button>
          </>
        )}
      </ScrollArea>
    </div>
  );
}
