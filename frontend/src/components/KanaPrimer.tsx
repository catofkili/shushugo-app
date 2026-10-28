import { useState } from "react";
import { KANA, getAnsweredKana, getKanaProgress, kanaMasteredCount, recordKanaAnswer } from "../lib/kana-progress";
import { nextKanaStep } from "../lib/kana-quiz";
import { refreshTodayWordPlan } from "../lib/api";
import { Sticker } from "./CapybaraMascot";
import { MascotSay } from "./MascotSay";
import { Disclosure } from "./Disclosure";

export function KanaPrimer() {
  const [progress, setProgress] = useState(getKanaProgress);
  const [introduced, setIntroduced] = useState(getAnsweredKana);
  const [recent, setRecent] = useState<string[]>([]);
  const [step, setStep] = useState(() => nextKanaStep(progress, introduced, []));
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const mastered = kanaMasteredCount(progress);

  const move = (symbol: string, nextProgress = progress) => {
    const nextIntroduced = new Set(introduced).add(symbol);
    const nextRecent = [symbol, ...recent].slice(0, 2);
    setIntroduced(nextIntroduced);
    setRecent(nextRecent);
    setStep(nextKanaStep(nextProgress, nextIntroduced, nextRecent));
  };

  if (!step) {
    return <MascotSay sticker="mood-proud" tone="good" size={64} className="ds-say-onbg mb-4">
      <b>五十音完成！</b>新词计划已经自动开始，去背今天的单词吧。
    </MascotSay>;
  }
  const symbol = step.kind === "teach" ? step.teach.symbol : step.question.symbol;
  const isWo = symbol === "を" || symbol === "ヲ";
  return <section className="ds-card mb-4 p-4 sm:p-5">
    <div className="flex items-center gap-3">
      <Sticker name="mood-study" size={56} className="-my-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="ds-kicker">五十音起步</p>
        <h3 className="text-lg font-black">{step.kind === "teach" ? "认识一个新假名" : "先把假名认下来"}</h3>
      </div>
      <span className="ds-pill ds-pill-primary tabular-nums">{mastered} / {KANA.length}</span>
    </div>
    <div className="ds-bar mt-3"><i style={{ width: `${mastered / KANA.length * 100}%` }} /></div>

    {step.kind === "teach" ? <>
      <p className="kana-primer-glyph">{step.teach.symbol}</p>
      <p className="text-center text-2xl font-black">{step.teach.romaji}</p>
      <p className="mt-1 text-center text-sm" style={{ color: "var(--ds-ink-3)" }}>
        字源「{step.teach.origin}」 · {step.teach.symbol >= "ァ" ? "平假名" : "片假名"} {step.teach.pair}
      </p>
      <p className="kana-primer-note mt-3">{step.teach.note}</p>
      {step.teach.example && <p className="mt-2 text-sm">例：<b className="jp-ink">{step.teach.example[0]}</b> {step.teach.example[1]}</p>}
      <button className="ds-btn mt-4 w-full focus-ring" onClick={() => { setFeedback(null); move(step.teach.symbol); }}>记住了</button>
    </> : <>
      <p className={step.question.type === "write" ? "kana-primer-glyph kana-primer-latin" : step.question.type === "word" ? "kana-primer-glyph kana-primer-word" : "kana-primer-glyph"}>{step.question.prompt}</p>
      <p className="text-center text-sm font-semibold" style={{ color: "var(--ds-ink-3)" }}>{step.question.ask}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">{step.question.choices.map((choice) => <button key={choice.label} className={`ds-choice justify-center focus-ring${step.question.type === "write" || step.question.type === "pair" ? " kana-primer-choice-kana" : ""}`} onClick={() => {
          const { question } = step;
          const result = recordKanaAnswer(question.symbol, choice.correct);
          setProgress({ ...result.progress });
          if (result.completed) refreshTodayWordPlan();
          // 答错也直接下一题（2026-10-28 用户要求），正确答案和认错成了什么留在下面的气泡里；这个字很快会再考。
          setFeedback(choice.correct
            ? { ok: true, text: result.completed ? "五十音完成，新词计划已解锁。" : `对，${question.reveal}。` }
            : { ok: false, text: `${question.reveal}${choice.note ? `；${choice.note}` : ""}。` });
          move(question.symbol, result.progress);
        }}>{choice.label}</button>)}</div>
    </>}
    {isWo && <p className="mt-2 text-center text-xs" style={{ color: "var(--ds-ink-3)" }}>wo 是五十音表的写法；を/ヲ 作助词时读 o。</p>}
    {feedback && <div role="status"><MascotSay sticker={feedback.ok ? "mood-yay" : "mood-puzzled"} tone={feedback.ok ? "good" : "warn"} size={48} className="mt-3">{feedback.text}</MascotSay></div>}

    <Disclosure className="kana-primer-table mt-4" summaryClassName="cursor-pointer text-sm font-bold" summary="查看平假名与片假名表">
      <div className="mt-3 grid grid-cols-5 gap-1.5">{KANA.map(([kana, reading]) => <div key={kana} className="rounded-xl p-2 text-center" style={{ background: "var(--ds-surface)" }}>
        <b className="block text-xl">{kana}</b><small style={{ color: "var(--ds-ink-3)" }}>{reading}</small>
      </div>)}</div>
    </Disclosure>
  </section>;
}
