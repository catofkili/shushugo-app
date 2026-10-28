import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { KANA, KANA_MASTERY_DAYS, getAnsweredKana, getKanaStates, recordKanaAnswer, type KanaState } from "../lib/kana-progress";
import { nextKanaStep, soundOf } from "../lib/kana-quiz";
import { playKanaSound } from "../lib/kana-audio";
import { getStudyPreferences } from "../lib/studyPreferences";
import { refreshTodayWordPlan } from "../lib/api";
import { Sticker } from "./CapybaraMascot";
import { MascotSay } from "./MascotSay";
import { Disclosure } from "./Disclosure";

const count = (states: Record<string, KanaState>, ...stages: KanaState["stage"][]) =>
  Object.values(states).filter((state) => stages.includes(state.stage)).length;

export function KanaPrimer() {
  const [states, setStates] = useState(() => getKanaStates());
  const [introduced, setIntroduced] = useState(getAnsweredKana);
  const [recent, setRecent] = useState<string[]>([]);
  const [step, setStep] = useState(() => nextKanaStep(states, introduced, []));
  // 答对答错都直接下一题；上一题的正确答案留在气泡里，带一个喇叭可以再听。
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; sound?: string } | null>(null);
  // 「今天会了」= 今天过关 + 已掌握。隔天会掉回去重考，所以第二天一开始这个数会掉很多。
  const known = count(states, "passed", "mastered");
  const mastered = count(states, "mastered");

  const sound = step?.kind === "teach" ? soundOf(step.teach.symbol) : step?.kind === "quiz" && step.question.type === "listen" ? step.question.sound : undefined;
  useEffect(() => {
    if (sound && getStudyPreferences().autoPlay) playKanaSound(sound);
  }, [step, sound]);

  const move = (symbol: string, nextStates = states) => {
    const nextIntroduced = new Set(introduced).add(symbol);
    const nextRecent = [symbol, ...recent].slice(0, 2);
    setIntroduced(nextIntroduced);
    setRecent(nextRecent);
    setStep(nextKanaStep(nextStates, nextIntroduced, nextRecent));
  };

  if (!step) {
    return <MascotSay sticker="mood-proud" tone="good" size={64} className="ds-say-onbg mb-4">
      <b>五十音完成！</b>新词计划已经自动开始，去背今天的单词吧。
    </MascotSay>;
  }
  const symbol = step.kind === "teach" ? step.teach.symbol : step.kind === "quiz" ? step.question.symbol : "";
  const isWo = symbol === "を" || symbol === "ヲ";
  const speaker = (clip: string, label: string) => <button type="button" className="kana-primer-speaker focus-ring" aria-label={label} onClick={() => playKanaSound(clip)}><Volume2 size={20} aria-hidden="true" /></button>;
  return <section className="ds-card mb-4 p-4 sm:p-5">
    <div className="flex items-center gap-3">
      <Sticker name="mood-study" size={56} className="-my-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="ds-kicker">五十音起步</p>
        <h3 className="text-lg font-black">{step.kind === "teach" ? "认识一个新假名" : step.kind === "rest" ? "今天的都过关了" : "先把假名认下来"}</h3>
      </div>
      <span className="ds-pill ds-pill-primary tabular-nums">{known} / {KANA.length}</span>
    </div>
    <div className="ds-bar mt-3"><i style={{ width: `${known / KANA.length * 100}%` }} /></div>
    <p className="mt-1.5 text-xs" style={{ color: "var(--ds-ink-3)" }}>已掌握 {mastered} 个 · {KANA_MASTERY_DAYS} 天都答对才算</p>

    {step.kind === "rest" ? <p className="mt-4 text-sm ds-ink2">还有 {step.left} 个要隔天再考，明天再来。</p>
    : step.kind === "teach" ? <>
      <div className="kana-primer-prompt">
        <p className="kana-primer-glyph">{step.teach.symbol}</p>
        {speaker(soundOf(step.teach.symbol), "再听一遍")}
      </div>
      <p className="text-center text-2xl font-black">{step.teach.romaji}</p>
      <p className="mt-1 text-center text-sm" style={{ color: "var(--ds-ink-3)" }}>
        字源「{step.teach.origin}」 · {step.teach.symbol >= "ァ" ? "平假名" : "片假名"} {step.teach.pair}
      </p>
      <p className="kana-primer-note mt-3">{step.teach.note}</p>
      {step.teach.example && <p className="mt-2 text-sm">例：<b className="jp-ink">{step.teach.example[0]}</b> {step.teach.example[1]}</p>}
      <button className="ds-btn mt-4 w-full focus-ring" onClick={() => { setFeedback(null); move(step.teach.symbol); }}>记住了</button>
    </> : <>
      {step.question.type === "listen"
        ? <div className="kana-primer-prompt"><button type="button" className="kana-primer-listen focus-ring" aria-label="播放读音" onClick={() => playKanaSound(step.question.sound!)}><Volume2 size={40} aria-hidden="true" /></button></div>
        : <p className={step.question.type === "write" ? "kana-primer-glyph kana-primer-latin" : step.question.type === "word" ? "kana-primer-glyph kana-primer-word" : "kana-primer-glyph"}>{step.question.prompt}</p>}
      <p className="text-center text-sm font-semibold" style={{ color: "var(--ds-ink-3)" }}>{step.question.ask}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">{step.question.choices.map((choice) => <button key={choice.label} className={`ds-choice justify-center focus-ring${["write", "pair", "listen"].includes(step.question.type) ? " kana-primer-choice-kana" : ""}`} onClick={() => {
        const { question } = step;
        const result = recordKanaAnswer(question.symbol, choice.correct);
        setStates(result.states);
        if (result.completed) refreshTodayWordPlan();
        setFeedback(choice.correct
          ? { ok: true, text: result.completed ? "五十音完成，新词计划已解锁。" : `对，${question.reveal}。`, sound: question.sound }
          : { ok: false, text: `${question.reveal}${choice.note ? `；${choice.note}` : ""}。`, sound: question.sound });
        move(question.symbol, result.states);
      }}>{choice.label}</button>)}</div>
    </>}
    {isWo && <p className="mt-2 text-center text-xs" style={{ color: "var(--ds-ink-3)" }}>wo 是五十音表的写法；を/ヲ 作助词时读 o。</p>}
    {feedback && <div role="status"><MascotSay sticker={feedback.ok ? "mood-yay" : "mood-puzzled"} tone={feedback.ok ? "good" : "warn"} size={48} className="mt-3">
      <span className="kana-primer-feedback">{feedback.text}{feedback.sound && speaker(feedback.sound, "听上一题的读音")}</span>
    </MascotSay></div>}

    <Disclosure className="kana-primer-table mt-4" summaryClassName="cursor-pointer text-sm font-bold" summary="查看平假名与片假名表 · 点字听读音">
      <div className="mt-3 grid grid-cols-5 gap-1.5">{KANA.map(([kana, reading]) => <button type="button" key={kana} className="rounded-xl p-2 text-center" style={{ background: "var(--ds-surface)" }} onClick={() => playKanaSound(reading)}>
        <b className="block text-xl">{kana}</b><small style={{ color: "var(--ds-ink-3)" }}>{reading}</small>
      </button>)}</div>
    </Disclosure>
  </section>;
}
