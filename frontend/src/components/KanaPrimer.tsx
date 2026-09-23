import { useMemo, useState } from "react";
import { KANA, getKanaProgress, kanaMasteredCount, kanaQuizChoices, recordKanaAnswer } from "../lib/kana-progress";
import { refreshTodayWordPlan } from "../lib/api";
import { Sticker } from "./CapybaraMascot";
import { MascotSay } from "./MascotSay";

export function KanaPrimer() {
  const [progress, setProgress] = useState(getKanaProgress);
  const next = useMemo(() => {
    const index = KANA.findIndex(([kana]) => (progress[kana] ?? 0) < 2);
    return index < 0 ? null : index;
  }, [progress]);
  const [attempt, setAttempt] = useState(0);
  const choices = useMemo(() => next === null ? [] : kanaQuizChoices(next, attempt), [next, attempt]);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const mastered = kanaMasteredCount(progress);
  if (next === null) {
    return <MascotSay sticker="mood-proud" tone="good" size={64} className="ds-say-onbg mb-4">
      <b>五十音完成！</b>新词计划已经自动开始，去背今天的单词吧。
    </MascotSay>;
  }
  const [kana, romaji] = KANA[next];
  const isWo = kana === "を" || kana === "ヲ";
  return <section className="ds-card mb-4 p-4 sm:p-5">
    <div className="flex items-center gap-3">
      <Sticker name="mood-study" size={56} className="-my-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="ds-kicker">五十音起步</p>
        <h3 className="text-lg font-black">先把假名认下来</h3>
      </div>
      <span className="ds-pill ds-pill-primary tabular-nums">{mastered} / {KANA.length}</span>
    </div>
    <div className="ds-bar mt-3"><i style={{ width: `${mastered / KANA.length * 100}%` }} /></div>

    <p className="kana-primer-glyph">{kana}</p>
    <p className="text-center text-sm font-semibold" style={{ color: "var(--ds-ink-3)" }}>选出它的罗马字 · 连对两次算学会</p>
    {isWo && <p className="mt-1 text-center text-xs" style={{ color: "var(--ds-ink-3)" }}>wo 是五十音表的写法；を/ヲ 作助词时读 o。</p>}
    <div className="mt-4 grid grid-cols-2 gap-2">{choices.map((choice) => <button key={choice} className="ds-choice justify-center focus-ring" onClick={() => {
      setAttempt((value) => value + 1);
      const correct = choice === romaji;
      const result = recordKanaAnswer(kana, correct);
      setProgress({ ...result.progress });
      if (result.completed) refreshTodayWordPlan();
      setFeedback(correct
        ? { ok: true, text: result.completed ? "五十音完成，新词计划已解锁。" : `对，${kana} 就是 ${romaji}。` }
        : { ok: false, text: `${kana} 读 ${romaji}，再来一次。` });
    }}>{choice}</button>)}</div>
    {feedback && <div role="status"><MascotSay sticker={feedback.ok ? "mood-yay" : "mood-puzzled"} tone={feedback.ok ? "good" : "warn"} size={48} className="mt-3">{feedback.text}</MascotSay></div>}

    <details className="kana-primer-table mt-4">
      <summary className="cursor-pointer text-sm font-bold">查看平假名与片假名表</summary>
      <div className="mt-3 grid grid-cols-5 gap-1.5">{KANA.map(([symbol, reading]) => <div key={symbol} className="rounded-xl p-2 text-center" style={{ background: "var(--ds-surface)" }}>
        <b className="block text-xl">{symbol}</b><small style={{ color: "var(--ds-ink-3)" }}>{reading}</small>
      </div>)}</div>
    </details>
  </section>;
}
