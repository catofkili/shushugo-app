import { useMemo, useState } from "react";
import { KANA, getKanaProgress, kanaMasteredCount, recordKanaAnswer } from "../lib/kana-progress";
import { refreshTodayWordPlan } from "../lib/api";

const choicesFor = (index: number) => {
  const correct = KANA[index][1];
  const options = new Set<string>([correct]);
  for (let offset = 7; options.size < 4; offset += 11) options.add(KANA[(index + offset) % KANA.length][1]);
  return [...options].sort((a, b) => ((a.charCodeAt(0) + index) % 7) - ((b.charCodeAt(0) + index) % 7));
};

export function KanaPrimer() {
  const [progress, setProgress] = useState(getKanaProgress);
  const next = useMemo(() => {
    const index = KANA.findIndex(([kana]) => (progress[kana] ?? 0) < 2);
    return index < 0 ? null : index;
  }, [progress]);
  const [feedback, setFeedback] = useState("");
  const mastered = kanaMasteredCount(progress);
  if (next === null) return <div className="mb-4 rounded-3xl border border-[#81D8CF]/60 bg-[#81D8CF]/12 p-5"><p className="text-lg font-black jp-ink">五十音完成 ✓</p><p className="mt-1 text-sm jp-muted">新词计划已经自动开始。</p></div>;
  const [kana, romaji] = KANA[next];
  return <div className="mb-4 rounded-3xl jp-card p-5">
    <div className="flex items-baseline justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] jp-muted">五十音起步</p><h3 className="mt-1 text-lg font-black jp-ink">按掌握进度推进</h3></div><b className="tabular-nums jp-ink">{mastered} / {KANA.length}</b></div>
    <div className="mt-4 h-2 overflow-hidden rounded-full jp-track"><div className="h-full rounded-full jp-accent" style={{ width: `${mastered / KANA.length * 100}%` }} /></div>
    <p className="mt-5 text-center text-6xl font-black jp-ink">{kana}</p>
    <p className="mt-2 text-center text-sm jp-muted">选出读音；每个假名连续答对两次算掌握</p>
    <div className="mt-4 grid grid-cols-2 gap-2">{choicesFor(next).map((choice) => <button key={choice} className="focus-ring h-11 rounded-2xl jp-btn text-sm font-bold jp-ink" onClick={() => {
      const correct = choice === romaji;
      const result = recordKanaAnswer(kana, correct);
      setProgress({ ...result.progress });
      if (result.completed) refreshTodayWordPlan();
      setFeedback(correct ? (result.completed ? "五十音完成，新词计划已解锁。" : "答对了") : `读音是 ${romaji}，再来一次`);
    }}>{choice}</button>)}</div>
    {feedback && <p className="mt-3 text-center text-sm font-bold jp-muted" role="status">{feedback}</p>}
    <details className="mt-4 rounded-2xl jp-inset p-3"><summary className="cursor-pointer text-sm font-bold jp-ink">查看平假名与片假名表</summary>
      <div className="mt-3 grid grid-cols-5 gap-2">{KANA.map(([symbol, reading]) => <div key={symbol} className="rounded-xl jp-card p-2 text-center"><b className="block text-xl jp-ink">{symbol}</b><small className="jp-muted">{reading}</small></div>)}</div>
    </details>
  </div>;
}
