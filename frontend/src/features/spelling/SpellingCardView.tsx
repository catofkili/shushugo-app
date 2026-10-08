import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  checkCardInput, classifyInput, kanaToRomaji, markDifferences, spellingHints,
  type MarkedText, type SpellingCard, type SpellingLookup, type SpellingRound, type SpellingVerdict
} from "../../lib/spelling";
import { playPronunciation } from "../../lib/speech";
import { scrollPageToTop, touchEventsEnabled } from "../../lib/touch-adapter";
import type { WordAnswer } from "../../types/vocabulary";
import { answerHotkeyLabels, answerOptions } from "../word-study/word-study-utils";
import {
  addHint, confirmsInput, createRoundState, MAX_HINTS, reveal, submit, toRound, type RoundState
} from "./round-state";
import { SpellingPrompt } from "./SpellingPrompt";
import "../../pages/spelling.css";

interface Props {
  card: SpellingCard;
  /** 用户选了档位：写流水和 FSRS。抛错时卡片留在原地让用户重试。 */
  onFinish: (round: SpellingRound) => void;
  /** 写完之后换下一张（页面）/ 关掉插播。 */
  onNext: () => void;
  autoFocus?: boolean;
  checkInput?: (typed: string) => SpellingVerdict;
  autoPlay?: boolean;
  voiceId?: string;
  showMeaning?: boolean;
  showTranslation?: boolean;
}

const clock = () => Date.now();
const EMPTY_LOOKUP: SpellingLookup = { bySurface: () => [], peers: () => [] };

/** 不一样的字标红（规格 §1.0）；颜色之外加下划线，不靠颜色一种线索。 */
const Marked = ({ parts }: { parts: MarkedText[] }) => <>
  {parts.map((part, index) => part.wrong
    ? <span key={index} className="sp-diff">{part.text}</span>
    : <span key={index}>{part.text}</span>)}
</>;

function CardInteraction({ card, onFinish, onNext, autoFocus = true, checkInput, autoPlay = false, voiceId, showMeaning = false, showTranslation = true }: Props) {
  const [state, setState] = useState(() => createRoundState(Date.now()));
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const current = useRef(state);
  const inputValue = useRef("");
  const composing = useRef(false);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const autoPlayed = useRef(false);
  const revealPlayed = useRef(false);
  const playbackAttempt = useRef(0);
  const [playbackError, setPlaybackError] = useState("");
  const hints = spellingHints(card.target, card.mode, card.meaning).slice(0, state.hintsUsed);
  const empty = classifyInput(typed).form === "empty";
  const diff = state.revealed && state.typed ? markDifferences(card.target, state.typed, state.verdict?.correct === true) : null;
  const playAudio = useCallback(() => {
    const attempt = ++playbackAttempt.current;
    setPlaybackError("");
    void playPronunciation(card.target.surface, card.target.kana, voiceId).catch(() => {
      if (attempt === playbackAttempt.current) setPlaybackError("播放失败，请重试");
    });
  }, [card.target.kana, card.target.surface, voiceId]);

  useEffect(() => {
    if (card.mode !== "audio" || autoPlayed.current) return;
    autoPlayed.current = true;
    playAudio();
  }, [card.mode, playAudio]);

  const keepPromptVisible = () => {
    if (touchEventsEnabled()) scrollPageToTop();
    else article.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
  };

  useEffect(() => {
    if (!autoFocus) return;
    // 先让题面落屏，再开键盘；后一次滚动等手机键盘改变可视高度。
    const focusTimer = setTimeout(() => input.current?.focus?.({ preventScroll: true }), 350);
    const scrollTimer = setTimeout(keepPromptVisible, 650);
    return () => { clearTimeout(focusTimer); clearTimeout(scrollTimer); };
  }, [autoFocus]);

  useEffect(() => {
    // 输入框没了，焦点交给卡片本身：V / B / N / M 选档位；Enter 不选，免得按住回车连着给档位。
    if (state.revealed) article.current?.focus?.({ preventScroll: true });
  }, [state.revealed]);

  useEffect(() => {
    if (!state.revealed || revealPlayed.current || !autoPlay || card.mode === "audio") return;
    revealPlayed.current = true;
    void playPronunciation(card.target.surface, card.target.kana, voiceId).catch(() => undefined);
  }, [state.revealed, autoPlay, card.mode, card.target.kana, card.target.surface, voiceId]);

  const change = (next: RoundState) => { current.current = next; setState(next); setError(""); };

  const submitInput = () => {
    if (busy.current || composing.current || current.current.revealed) return;
    const value = inputValue.current;
    if (classifyInput(value).form === "empty") return;
    try {
      // 默认也显式给空 lookup，免得嵌入卡片时 checkCardInput 的默认参数偷偷查库。
      change(submit(current.current, value, checkInput ? checkInput(value) : checkCardInput(card, value, EMPTY_LOOKUP)));
    } catch {
      setError("暂时没法核对，请重试");
    }
  };

  const choose = (grade: WordAnswer) => {
    if (busy.current || !current.current.revealed) return;
    busy.current = true;
    try {
      // 结算和换卡分开；不放进 effect / setState updater，避免 StrictMode 重放写两遍。
      onFinish(toRound(current.current, grade, clock()));
    } catch {
      busy.current = false;
      setError("这次没能保存，请重试");
      return;
    }
    try { onNext(); }
    catch { busy.current = false; setError("下一张暂时打不开，请重试"); }
  };

  const handleEnter = (event: KeyboardEvent<HTMLElement>) => {
    if (!confirmsInput(event, composing.current)) return;
    event.preventDefault?.();
    submitInput();
  };

  const handleGradeKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!state.revealed || event.target !== event.currentTarget) return;
    const hit = answerOptions.find((option) => answerHotkeyLabels[option.value].toLowerCase() === event.key.toLowerCase());
    if (!hit) return;
    event.preventDefault?.();
    choose(hit.value);
  };

  const reading = diff?.answer.length ? diff : null;
  return (
    <div ref={article} tabIndex={-1} onKeyDown={handleGradeKey} className="ds-card sp-card">
      <SpellingPrompt card={card} showMeaning={showMeaning} showTranslation={showTranslation}
        playbackError={playbackError} onReplay={playAudio} />
      {hints.length > 0 && !state.revealed && <div className="ds-inset sp-hints" aria-live="polite" lang="ja">
        {hints.map((hint) => <p key={hint.level} className="sp-hint" lang="ja">
          {hint.level === 1 ? `${hint.moraCount} 拍 · ${hint.first}${hint.meaning ? ` · ${hint.meaning}` : ""}`
            : hint.level === 2 ? `${hint.kana} · ${hint.romaji}` : hint.surface}
        </p>)}
      </div>}
      <div className="sp-response">
        {state.revealed ? <div aria-live="polite" className="ds-inset sp-answer">
          {diff && <>
            <p className="sp-answer-title">你写的</p>
            <p className="sp-typed" lang="ja"><Marked parts={diff.typed} /></p>
          </>}
          <p className="sp-answer-title">答案</p>
          <p className="sp-answer-surface" lang="ja">
            {reading?.against === "surface" ? <Marked parts={reading.answer} /> : card.target.surface}
          </p>
          <p className="sp-reading" lang="ja">
            {reading?.against === "kana" ? <Marked parts={reading.answer} /> : card.target.kana}
            {" · "}
            {reading?.against === "romaji" ? <Marked parts={reading.answer} /> : kanaToRomaji(card.target.kana)}
          </p>
        </div> : <input
          ref={input}
          type="text"
          lang="ja"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={-1}
          value={typed}
          onChange={(event) => { inputValue.current = event.target.value; setTyped(event.target.value); }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onFocus={keepPromptVisible}
          onKeyDown={handleEnter}
          // plugin-html 映射 keypress → confirm；网页已经在 keydown 提交，不能再提交一次。
          onKeyPress={(event) => { if (event.type === "confirm") handleEnter(event); }}
          placeholder="罗马音 / 假名 / 汉字都行"
          aria-label="单词拼写答案"
          className="ds-inset sp-input"
        />}
        {error && <p className="sp-error" role="status">{error}</p>}
      </div>
      {state.revealed
        // 档位和单词学习是同一副：忘记 / 认识是主键，模糊 / 熟知摆一半宽。选哪个由用户定，我们不给建议。
        ? <div className="sp-grades" role="group" aria-label="这个词你记得怎么样">
          {answerOptions.map((option) => <button key={option.value} type="button"
            aria-keyshortcuts={answerHotkeyLabels[option.value]}
            className={`focus-ring sp-grade ${option.value === "know" ? "ds-btn" : "ds-btn-soft"} ${option.secondary ? "sp-grade-secondary" : ""}`}
            onClick={() => choose(option.value)}>
            <span className="sp-grade-key kbd-hint">{answerHotkeyLabels[option.value]}</span>
            <span>{option.label}</span>
          </button>)}
        </div>
        : <div className="sp-actions">
          <div className="sp-soft-actions">
            <button type="button" className="ds-btn-soft sp-button" disabled={state.hintsUsed >= MAX_HINTS}
              aria-label={`提示 ${state.hintsUsed}/${MAX_HINTS}`} onClick={() => change(addHint(current.current))}>
              提示 {state.hintsUsed}/{MAX_HINTS}
            </button>
            <button type="button" className="ds-btn-soft sp-button" onClick={() => change(reveal(current.current))}>看答案</button>
          </div>
          <button type="button" className="ds-btn sp-button sp-primary" disabled={empty} onClick={submitInput}>提交</button>
        </div>}
    </div>
  );
}

// 嵌入流程更换词时也重开一轮；同词撤销 / 再练由页面的实例 key 区分。
export function SpellingCardView(props: Props) {
  return <CardInteraction key={props.card.wordId} {...props} />;
}
