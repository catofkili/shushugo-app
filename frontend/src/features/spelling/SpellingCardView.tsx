import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  checkCardInput, classifyInput, kanaToRomaji, problemMessage, roundOutcome, spellingHints,
  type SpellingCard, type SpellingInputForm, type SpellingLookup, type SpellingRound, type SpellingVerdict
} from "../../lib/spelling";
import { playPronunciation } from "../../lib/speech";
import { scrollPageToTop, touchEventsEnabled } from "../../lib/touch-adapter";
import {
  canOverrideCorrect, canOverrideWrong, confirmsInput, createRoundState, giveUp, lastVerdict,
  overrideCorrect, overrideWrong, submit, toRound, useHint as addHint, visibleHintCount, type RoundState
} from "./round-state";
import { SpellingPrompt } from "./SpellingPrompt";
import "../../pages/spelling.css";

interface Props {
  card: SpellingCard;
  onFinish: (round: SpellingRound) => void;
  onAmend: (round: SpellingRound) => void;
  onNext: () => void;
  autoFocus?: boolean;
  checkInput?: (typed: string) => SpellingVerdict;
  autoPlay?: boolean;
  voiceId?: string;
  showMeaning?: boolean;
  showTranslation?: boolean;
  /** 插播时按钮写「继续」而不是「下一个」。 */
  nextLabel?: string;
}

const EMPTY_LOOKUP: SpellingLookup = { bySurface: () => [], peers: () => [] };
const INPUT_LABEL: Record<SpellingInputForm, string> = {
  empty: "", romaji: "罗马音", kana: "假名", kanji: "汉字", mixed: "汉字", other: "混着写了"
};

function CardInteraction({ card, onFinish, onAmend, onNext, autoFocus = true, checkInput, autoPlay = false, voiceId, nextLabel = "下一个", showMeaning = false, showTranslation = true }: Props) {
  const [state, setState] = useState(() => createRoundState(Date.now()));
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const current = useRef(state);
  const inputValue = useRef("");
  const composing = useRef(false);
  const busy = useRef(false);
  const advancing = useRef(false);
  const persisted = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const autoPlayed = useRef(false);
  const playbackAttempt = useRef(0);
  const [playbackError, setPlaybackError] = useState("");
  const outcome = roundOutcome(toRound(state, state.startedAt));
  const verdict = lastVerdict(state);
  const hints = spellingHints(card.target, card.mode, card.meaning).slice(0, visibleHintCount(state));
  const form = classifyInput(typed).form;
  const correct = outcome.done && (state.override === "correct" || (!state.override && !state.gaveUp && verdict?.correct));
  const surface = correct && verdict?.matched?.kind === "form" ? verdict.matched.text : card.target.surface;
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
    if (outcome.done) nextButton.current?.focus?.({ preventScroll: true });
    else if (state.attempts.length) {
      input.current?.focus?.({ preventScroll: true });
      if (touchEventsEnabled()) {
        input.current?.setAttribute("selection-start", "0");
        input.current?.setAttribute("selection-end", String(inputValue.current.length));
      } else input.current?.select?.();
    }
  }, [outcome.done, state.attempts.length]);

  const changeRound = (next: RoundState) => {
    if (busy.current || next === current.current) return;
    busy.current = true;
    const finished = roundOutcome(toRound(next, next.startedAt)).done;
    try {
      // 结算和换卡分开；不放进 effect / setState updater，避免 StrictMode 重放写两遍。
      if (finished && !persisted.current) {
        onFinish({ ...toRound(next, Date.now()), mode: card.mode });
        persisted.current = true;
      }
      current.current = next;
      setState(next);
      setError("");
      if (finished && !next.gaveUp && lastVerdict(next)?.correct && autoPlay && card.mode !== "audio") {
        void playPronunciation(card.target.surface, card.target.kana, voiceId).catch(() => undefined);
      }
    } catch {
      setError("这次没能保存，请重试");
    } finally {
      busy.current = false;
    }
  };

  const adjudicate = (kind: "correct" | "wrong") => {
    if (busy.current) return;
    const previous = current.current;
    const next = kind === "correct" ? overrideCorrect(previous) : overrideWrong(previous);
    if (next === previous) return;
    busy.current = true;
    const finished = roundOutcome(toRound(next, next.startedAt)).done;
    try {
      const round = { ...toRound(next, Date.now()), mode: card.mode };
      if (persisted.current) onAmend(round);
      else if (finished) onFinish(round);
      persisted.current = finished;
      current.current = next;
      setState(next);
      setError("");
    } catch {
      setError("这次没能保存，请重试");
    } finally {
      busy.current = false;
    }
  };

  const submitInput = () => {
    if (busy.current || composing.current || roundOutcome(toRound(current.current, current.current.startedAt)).done) return;
    const value = inputValue.current;
    if (classifyInput(value).form === "empty") return;
    try {
      // 默认也显式给空 lookup，免得嵌入卡片时 checkCardInput 的默认参数偷偷查库。
      const checked = checkInput ? checkInput(value) : checkCardInput(card, value, EMPTY_LOOKUP);
      changeRound(submit(current.current, value, checked));
    } catch {
      setError("暂时没法核对，请重试");
    }
  };

  const advance = () => {
    if (advancing.current) return;
    advancing.current = true;
    try { onNext(); }
    catch { advancing.current = false; setError("下一张暂时打不开，请重试"); }
  };

  const handleEnter = (event: KeyboardEvent<HTMLElement>) => {
    if (!confirmsInput(event, composing.current)) return;
    event.preventDefault?.();
    if (outcome.done) advance();
    else submitInput();
  };

  const problem = verdict?.problems[0];
  const resultAction = state.override ? "revert"
    : canOverrideCorrect(state) ? "correct"
      : canOverrideWrong(state) ? "wrong"
        : null;
  const runResultAction = () => {
    if (state.override === "correct") adjudicate("correct");
    else if (state.override === "wrong") adjudicate("wrong");
    else if (resultAction === "correct") adjudicate("correct");
    else if (resultAction === "wrong") adjudicate("wrong");
  };
  return (
    <div ref={article} className="ds-card sp-card">
      <SpellingPrompt card={card} showMeaning={showMeaning} showTranslation={showTranslation}
        playbackError={playbackError} onReplay={playAudio} />
      {hints.length > 0 && <div className="ds-inset sp-hints" aria-live="polite" lang="ja">
        {hints.map((hint) => <p key={hint.level} className="sp-hint" lang="ja">
          {hint.level === 1 ? `${hint.moraCount} 拍 · ${hint.first}${hint.meaning ? ` · ${hint.meaning}` : ""}`
            : hint.level === 2 ? `${hint.kana} · ${hint.romaji}` : hint.surface}
        </p>)}
      </div>}
      <div className="sp-response">
        {outcome.done ? <div aria-live="polite" className={`ds-inset sp-answer ${correct ? "sp-answer-correct" : ""}`}>
          <p className="sp-answer-title">{correct ? "答对了" : "答案"}</p>
          <p className="sp-answer-surface" lang="ja">{surface}</p>
          <p className="sp-reading" lang="ja">{card.target.kana} · {kanaToRomaji(card.target.kana)}</p>
          {state.override === "correct" && <p className="sp-preferred">按你说的算</p>}
          {correct && verdict?.matched?.preferred === false && <p className="sp-preferred">
            更常见的写法：<span lang="ja">{card.target.surface}</span>
          </p>}
          {resultAction && <button type="button" className="ds-chip focus-ring mt-3 opacity-65"
            aria-label={resultAction === "revert" ? "改回原来的判定" : resultAction === "correct" ? "把这次算作答对" : "把这次算作答错"}
            onClick={runResultAction}>{resultAction === "revert" ? "改回" : resultAction === "correct" ? "算我对" : "算我错"}</button>}
        </div> : <>
          <div className="sp-input-row">
            {state.attempts.length > 0 && <span className="sp-tries">还有 {outcome.triesLeft} 次</span>}
            <input
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
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? `sp-feedback-${card.wordId}` : undefined}
              className={`ds-inset sp-input ${state.attempts.length ? "sp-input-shake" : ""}`}
              key={state.attempts.length}
            />
          </div>
          {form !== "empty" && <p className="sp-recognition">{form === "other" ? "混着写了" : `识别为：${INPUT_LABEL[form]}`}</p>}
          {problem && <div aria-live="polite" id={`sp-feedback-${card.wordId}`} key={state.attempts.length}
            className={`ds-inset sp-feedback ${verdict?.nearMiss ? "sp-feedback-near" : ""}`}>
            {verdict?.nearMiss && <span className="sp-near-label">差一点</span>}
            <span>{problemMessage(problem, card.target)}</span>
            {canOverrideCorrect(state) && <button type="button" className="ds-chip focus-ring ml-auto shrink-0"
              aria-label="把这次算作答对" onClick={() => adjudicate("correct")}>算我对</button>}
          </div>}
        </>}
        {error && <p className="sp-error" role="status">{error}</p>}
      </div>
      <div className="sp-actions">
        <div className="sp-soft-actions">
          <button type="button" className="ds-btn-soft sp-button" disabled={outcome.done || state.hintsUsed >= 3}
            aria-label={`提示 ${state.hintsUsed}/3`} onClick={() => changeRound(addHint(current.current))}>
            提示 {state.hintsUsed}/3
          </button>
          <button type="button" className="ds-btn-soft sp-button" disabled={outcome.done}
            onClick={() => changeRound(giveUp(current.current))}>不会</button>
        </div>
        {outcome.done ? <button ref={nextButton} type="button" className="ds-btn sp-button sp-primary"
          onClick={advance} onKeyDown={handleEnter}>{nextLabel}</button>
          : <button type="button" className="ds-btn sp-button sp-primary" disabled={form === "empty"}
            onClick={submitInput}>提交</button>}
      </div>
    </div>
  );
}

// 嵌入流程更换词时也重开一轮；同词撤销 / 再练由页面的实例 key 区分。
export function SpellingCardView(props: Props) {
  return <CardInteraction key={props.card.wordId} {...props} />;
}
