import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { KANA, KANA_MASTERY_DAYS, getAnsweredKana, getKanaStates, recordKanaAnswer, type KanaState } from "../lib/kana-progress";
import { nextKanaStep, soundOf, type KanaStep } from "../lib/kana-quiz";
import { KANA_WORDS_PER_DAY, KANA_WORD_START_DAY, kanaStudyDay, newWordsToday, recordKanaWordAnswer, simpleWords, wordMeaningQuestion, type KanaWord, type KanaWordQuestion } from "../lib/kana-words";
import { playKanaSound } from "../lib/kana-audio";
import { playPronunciation } from "../lib/speech";
import { getStudyPreferences } from "../lib/studyPreferences";
import { refreshTodayWordPlan } from "../lib/api";
import { Sticker } from "./CapybaraMascot";
import { MascotSay } from "./MascotSay";
import { Disclosure } from "./Disclosure";

type Step = KanaStep | { kind: "word-teach"; word: KanaWord } | { kind: "word-quiz"; question: KanaWordQuestion; retry: boolean };
// 单词这一侧的本次状态。queue：教过、等着隔几题再考的词；retry 的是答错过一次的，再错就不再追。
type Words = { on: boolean; newToday: number; taught: number[]; queue: { word: KanaWord; after: number; retry: boolean }[]; turn: number };

const count = (states: Record<string, KanaState>, ...stages: KanaState["stage"][]) =>
  Object.values(states).filter((state) => stages.includes(state.stage)).length;

// 第三天起混词：单词的比例随已掌握的假名变多（30% → 80%），假名掌握一个就少出一个，全掌握了这张卡就收起来。
const pickStep = (states: Record<string, KanaState>, introduced: Set<string>, recent: string[], words: Words): [Step | null, Words] => {
  const kanaStep = nextKanaStep(states, introduced, recent);
  if (!kanaStep || !words.on) return [kanaStep, words];
  const turn = words.turn + 1;
  const due = words.queue.find((item) => item.after <= turn);
  if (due) return [{ kind: "word-quiz", question: wordMeaningQuestion(due.word), retry: due.retry }, { ...words, turn, queue: words.queue.filter((item) => item !== due) }];
  const share = Math.min(0.8, 0.3 + 0.5 * count(states, "mastered") / KANA.length);
  if (words.newToday + words.taught.length < KANA_WORDS_PER_DAY && (kanaStep.kind === "rest" || Math.random() < share)) {
    const word = simpleWords(introduced).find((candidate) => !words.taught.includes(candidate.id));
    if (word) return [{ kind: "word-teach", word }, { ...words, turn, taught: [...words.taught, word.id] }];
  }
  // 今天的假名过完了但词还在排队：先把排队的词考掉，不说「明天再来」
  if (kanaStep.kind === "rest" && words.queue.length) {
    const [first, ...rest] = words.queue;
    return [{ kind: "word-quiz", question: wordMeaningQuestion(first.word), retry: first.retry }, { ...words, turn, queue: rest }];
  }
  return [kanaStep, { ...words, turn }];
};

export function KanaPrimer() {
  const [states, setStates] = useState(() => getKanaStates());
  const [introduced, setIntroduced] = useState(getAnsweredKana);
  const [recent, setRecent] = useState<string[]>([]);
  const [initial] = useState(() => pickStep(states, introduced, [], {
    on: kanaStudyDay() >= KANA_WORD_START_DAY, newToday: newWordsToday(), taught: [], queue: [], turn: 0
  }));
  const [step, setStep] = useState<Step | null>(initial[0]);
  const [words, setWords] = useState<Words>(initial[1]);
  // 答对答错都直接下一题；上一题的正确答案留在气泡里，带一个喇叭可以再听。
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; sound?: string } | null>(null);
  // 「今天会了」= 今天过关 + 已掌握。隔天会掉回去重考，所以第二天一开始这个数会掉很多。
  const known = count(states, "passed", "mastered");
  const mastered = count(states, "mastered");

  const sound = step?.kind === "teach" ? soundOf(step.teach.symbol) : step?.kind === "quiz" && step.question.type === "listen" ? step.question.sound : undefined;
  useEffect(() => {
    if (sound && getStudyPreferences().autoPlay) playKanaSound(sound);
  }, [step, sound]);

  const advance = (nextStates: Record<string, KanaState>, nextWords: Words, symbol?: string) => {
    const nextIntroduced = symbol ? new Set(introduced).add(symbol) : introduced;
    const nextRecent = symbol ? [symbol, ...recent].slice(0, 2) : recent;
    const [next, wordsAfter] = pickStep(nextStates, nextIntroduced, nextRecent, nextWords);
    setIntroduced(nextIntroduced);
    setRecent(nextRecent);
    setWords(wordsAfter);
    setStep(next);
  };

  if (!step) {
    return <MascotSay sticker="mood-proud" tone="good" size={64} className="ds-say-onbg mb-4">
      <b>五十音完成！</b>新词计划已经自动开始，去背今天的单词吧。
    </MascotSay>;
  }
  const symbol = step.kind === "teach" ? step.teach.symbol : step.kind === "quiz" ? step.question.symbol : "";
  const isWo = symbol === "を" || symbol === "ヲ";
  const speaker = (clip: string, label: string) => <button type="button" className="kana-primer-speaker focus-ring" aria-label={label} onClick={() => playKanaSound(clip)}><Volume2 size={20} aria-hidden="true" /></button>;
  const title = step.kind === "teach" ? "认识一个新假名" : step.kind === "word-teach" ? "认识一个单词" : step.kind === "word-quiz" ? "用假名读单词" : step.kind === "rest" ? "今天的都过关了" : "先把假名认下来";
  return <section className="ds-card mb-4 p-4 sm:p-5">
    <div className="flex items-center gap-3">
      <Sticker name="mood-study" size={56} className="-my-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="ds-kicker">五十音起步</p>
        <h3 className="text-lg font-black">{title}</h3>
      </div>
      <span className="ds-pill ds-pill-primary tabular-nums">{known} / {KANA.length}</span>
    </div>
    <div className="ds-bar mt-3"><i style={{ width: `${known / KANA.length * 100}%` }} /></div>
    <p className="mt-1.5 text-xs" style={{ color: "var(--ds-ink-3)" }}>
      已掌握 {mastered} 个 · {KANA_MASTERY_DAYS} 天都答对才算{words.on && ` · 今天单词 ${Math.min(KANA_WORDS_PER_DAY, words.newToday + words.taught.length)} / ${KANA_WORDS_PER_DAY}`}
    </p>

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
      <button className="ds-btn mt-4 w-full focus-ring" onClick={() => { setFeedback(null); advance(states, words, step.teach.symbol); }}>记住了</button>
    </> : step.kind === "word-teach" ? <>
      <div className="kana-primer-prompt">
        <p className="kana-primer-glyph kana-primer-word">{step.word.kana}</p>
        <button type="button" className="kana-primer-speaker focus-ring" aria-label="听读音" onClick={() => { void playPronunciation(step.word.kanji, step.word.kana).catch(() => undefined); }}><Volume2 size={20} aria-hidden="true" /></button>
      </div>
      {step.word.kanji !== step.word.kana && <p className="text-center text-lg font-bold jp-ink">{step.word.kanji}</p>}
      <p className="mt-1 text-center text-xl font-black">{step.word.meaning}</p>
      <button className="ds-btn mt-4 w-full focus-ring" onClick={() => {
        setFeedback(null);
        advance(states, { ...words, queue: [...words.queue, { word: step.word, after: words.turn + 3, retry: false }] });
      }}>记住了</button>
    </> : step.kind === "word-quiz" ? <>
      <p className="kana-primer-glyph kana-primer-word">{step.question.word.kana}</p>
      <p className="text-center text-sm font-semibold" style={{ color: "var(--ds-ink-3)" }}>什么意思？</p>
      <div className="mt-4 grid grid-cols-2 gap-2">{step.question.choices.map((choice) => <button key={choice.label} className="ds-choice justify-center focus-ring" onClick={() => {
        const { word } = step.question;
        recordKanaWordAnswer(word.id, choice.correct);
        const reading = word.kanji !== word.kana ? `${word.kana}（${word.kanji}）` : word.kana;
        setFeedback(choice.correct ? { ok: true, text: `对，${reading} 是「${word.meaning}」。` } : { ok: false, text: `${reading} 是「${word.meaning}」${step.retry ? "" : "，一会儿再考"}。` });
        advance(states, choice.correct || step.retry ? words : { ...words, queue: [...words.queue, { word, after: words.turn + 3, retry: true }] });
      }}>{choice.label}</button>)}</div>
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
        advance(result.states, words, question.symbol);
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
