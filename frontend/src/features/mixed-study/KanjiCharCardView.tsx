import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Eye, RotateCcw } from "lucide-react";
import { answerHotkeyLabels, answerOptions } from "../word-study/word-study-utils";
import type { KanjiCharCard } from "../../lib/kanji-char-cards";
import { assignKanjiReadingPair, shuffleKanjiReadingOptions } from "../../lib/kanji-reading-usage";
import type { WordAnswer } from "../../types/vocabulary";

export const KANJI_ACCENT: CSSProperties = {
  "--quiz-accent": "#B9A7F2",
  "--quiz-accent-soft": "rgba(185,167,242,0.12)",
  "--quiz-accent-strong": "rgba(185,167,242,0.20)",
  "--quiz-accent-line": "rgba(185,167,242,0.45)"
} as CSSProperties;

const LEVELS = ["N5", "N4", "N3", "N2", "N1", "无级"];
const ROW_HEIGHT = 82;
const ROW_GAP = 8;

interface Props {
  card: KanjiCharCard;
  revealed: boolean;
  onReveal: () => void;
  onAnswer: (value: WordAnswer) => void;
}

export const KanjiCharCardView = ({ card, revealed, onReveal, onAnswer }: Props) => {
  const items = card.question?.items ?? [];
  const readings = useMemo(() => shuffleKanjiReadingOptions(items.map((item) => item.targetReading)), [card.char, card.question]);
  const diagramHeight = items.length * ROW_HEIGHT + Math.max(0, items.length - 1) * ROW_GAP;
  const rowCenter = (index: number) => ((index * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2) / diagramHeight) * 100;
  const [pairs, setPairs] = useState<Record<number, number>>({});
  const [selectedWord, setSelectedWord] = useState<number | null>(null);

  useEffect(() => {
    setPairs({});
    setSelectedWord(null);
  }, [card.char]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, textarea, select, [contenteditable='true']")) return;
      if (!revealed) {
        if (event.key.length === 1 || event.key === "Enter" || event.key === " ") { event.preventDefault(); onReveal(); }
        return;
      }
      const hit = answerOptions.find((option) => answerHotkeyLabels[option.value].toLowerCase() === event.key.toLowerCase());
      if (hit) { event.preventDefault(); onAnswer(hit.value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer, onReveal, revealed]);

  const selectReading = (readingIndex: number) => {
    if (revealed || selectedWord === null) return;
    setPairs((current) => assignKanjiReadingPair(current, selectedWord, readingIndex));
    setSelectedWord(null);
  };

  const allConnected = items.length > 0 && Object.keys(pairs).length === items.length;

  return (
    <div key={card.char} style={KANJI_ACCENT} className="kanji-match-card zoo-enter dictionary-card flex h-full min-h-0 flex-col gap-2 rounded-2xl px-3 pb-2 pt-3 sm:gap-3 sm:p-6">
      <div style={{ background: "linear-gradient(118deg,var(--ds-primary-tint-2),var(--ds-surface) 72%)" }} className="shrink-0 rounded-2xl border border-[var(--ds-line)] px-4 py-3 sm:px-5 sm:py-4 lg:mx-auto lg:w-[min(900px,100%)]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold tracking-[0.14em] text-[var(--ds-ink-3)]">单独汉字 · 读音连线</span>
          <span className="rounded-full border border-[var(--ds-line)] bg-[var(--ds-inset)] px-2 py-1 text-[10px] font-bold text-[var(--ds-ink-2)]">{LEVELS[card.levelRank] ?? "无级"}</span>
        </div>
        <div className="mt-2 flex items-center gap-3 sm:mt-3 sm:gap-4">
          <span className="jp-serif grid size-14 shrink-0 place-items-center rounded-2xl border border-[color:var(--quiz-accent-line)] bg-[color:var(--quiz-accent-soft)] text-4xl font-semibold text-[color:var(--quiz-accent)] sm:size-16 sm:text-5xl">{card.char}</span>
          <div className="min-w-0">
            <p className="text-base font-bold leading-6 text-[var(--ds-ink)] sm:text-lg">{items.length ? `把词语和「${card.char}」的读音连起来` : `先回想「${card.char}」的读音`}</p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ds-ink-2)]">{items.length ? "先选左边的词，再选右边对应的读音" : "翻面查看音读、训读和例词"}</p>
          </div>
        </div>
      </div>

      <div data-word-scrollable="true" className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-inset)] p-3 sm:p-6 lg:mx-auto lg:w-[min(900px,100%)]">
        {items.length > 0 && (
          <div className="mx-auto grid min-h-full max-w-2xl content-center">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[var(--ds-ink-2)]">已连 <b className="text-[color:var(--quiz-accent)]">{Object.keys(pairs).length}</b> / {items.length}</p>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--ds-line-2)]" aria-hidden="true">
                <div className="h-full rounded-full bg-[color:var(--quiz-accent)] transition-[width]" style={{ width: `${Object.keys(pairs).length / items.length * 100}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_60px_minmax(0,1fr)] items-end pb-2 text-[10px] font-bold tracking-wide text-[var(--ds-ink-3)] sm:text-xs">
              <span>词语 · 含「{card.char}」</span><span /><span className="text-right">读音选项</span>
            </div>
            <div
              className="relative grid grid-cols-[minmax(0,1fr)_60px_minmax(0,1fr)]"
              style={{ height: diagramHeight }}
            >
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute left-[calc(50%-30px)] top-0 z-0 h-full w-[60px] overflow-visible"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {items.map((item, wordIndex) => {
                  const centerY = rowCenter(wordIndex);
                  const assignedReading = pairs[wordIndex];
                  const correctReading = readings.indexOf(item.targetReading);
                  if (!revealed) {
                    return assignedReading === undefined ? null : (
                      <line key={`attempt-${wordIndex}`} x1="0" y1={centerY} x2="100" y2={rowCenter(assignedReading)} stroke="var(--quiz-accent)" strokeWidth="2.6" strokeLinecap="round" opacity="0.8" />
                    );
                  }
                  return (
                    <g key={`answer-${wordIndex}`}>
                      {assignedReading !== undefined && assignedReading !== correctReading && (
                        <line x1="0" y1={centerY} x2="100" y2={rowCenter(assignedReading)} stroke="var(--ds-danger)" strokeWidth="2.4" strokeLinecap="round" opacity="0.78" />
                      )}
                      <line x1="0" y1={centerY} x2="100" y2={rowCenter(correctReading)} stroke="var(--ds-primary)" strokeWidth="2.8" strokeLinecap="round" opacity="0.92" />
                    </g>
                  );
                })}
              </svg>

              <div className="relative z-10 grid grid-cols-1" style={{ gridTemplateRows: `repeat(${items.length}, ${ROW_HEIGHT}px)`, rowGap: ROW_GAP }}>
                {items.map((item, wordIndex) => {
                  const assigned = pairs[wordIndex];
                  return (
                    <button
                      key={`word-${item.word}-${wordIndex}`}
                      type="button"
                      disabled={revealed}
                      aria-pressed={selectedWord === wordIndex}
                      aria-label={`${item.word}，${item.meaning}`}
                      onClick={() => setSelectedWord((current) => current === wordIndex ? null : wordIndex)}
                      className={`relative z-10 flex h-full min-w-0 flex-col justify-center rounded-2xl border px-2.5 text-left transition-colors sm:px-3 ${selectedWord === wordIndex ? "border-[color:var(--quiz-accent)] bg-[color:var(--quiz-accent-soft)] shadow-[0_0_0_2px_rgba(215,181,241,.1)]" : assigned !== undefined && !revealed ? "border-[color:var(--quiz-accent-line)] bg-[color:var(--quiz-accent-soft)]" : "border-[var(--ds-line)] bg-[var(--ds-surface)] hover:border-[var(--ds-line-2)]"}`}
                    >
                      <span className="jp-serif truncate text-sm font-bold text-[var(--ds-ink)] sm:text-base">{item.word}</span>
                      {revealed && <span className="jp truncate text-[10px] text-[var(--ds-primary-ink)] sm:text-xs">{item.wordKana}</span>}
                      <span className="line-clamp-2 mt-0.5 text-[10px] leading-4 text-[var(--ds-ink-2)] sm:text-[11px]">{item.meaning}</span>
                    </button>
                  );
                })}
              </div>
              <div aria-hidden="true" />
              <div className="relative z-10 grid grid-cols-1" style={{ gridTemplateRows: `repeat(${items.length}, ${ROW_HEIGHT}px)`, rowGap: ROW_GAP }}>
                {readings.map((option, readingIndex) => {
                  const assignedBy = Object.entries(pairs).find(([, value]) => value === readingIndex)?.[0];
                  const correctFor = items.findIndex((item) => item.targetReading === option);
                  const isCorrectLine = revealed && Number(assignedBy) === correctFor;
                  return (
                    <button
                      key={`reading-${option}`}
                      type="button"
                      disabled={revealed || selectedWord === null}
                      aria-label={`读音 ${option}`}
                      aria-pressed={assignedBy !== undefined}
                      onClick={() => selectReading(readingIndex)}
                    className={`relative z-10 flex h-full min-w-0 items-center justify-end rounded-2xl border px-2.5 text-right transition-colors sm:px-3 ${isCorrectLine ? "border-[var(--ds-primary)] bg-[var(--ds-primary-tint)]" : assignedBy !== undefined ? "border-[color:var(--quiz-accent-line)] bg-[color:var(--quiz-accent-soft)]" : selectedWord !== null && !revealed ? "border-[var(--ds-line-2)] bg-[var(--ds-surface)] hover:border-[color:var(--quiz-accent)]" : "border-[var(--ds-line)] bg-[var(--ds-surface)]"} ${selectedWord !== null && !revealed ? "cursor-pointer" : ""}`}
                    >
                      <span className="jp text-base font-bold text-[var(--ds-ink)] sm:text-lg">{option}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {!revealed && <p className="mt-3 text-center text-xs text-[var(--ds-ink-2)]">先点左侧词语，再点右侧读音；已连好的词可以重新选择。</p>}
            {revealed && <p className="mt-3 text-center text-xs text-[var(--ds-ink-2)]">绿色线是正确答案，红色线是你原来的错误连线。</p>}
          </div>
        )}

        {revealed ? (
          <div className="zoo-reveal-in mx-auto mt-5 max-w-2xl text-left">
            {items.length === 0 && <p className="jp-serif text-7xl text-center font-semibold">{card.char}</p>}
            {card.on.length > 0 || card.kun.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-surface)] px-3 py-2">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ds-ink-3)]">音读</p>
                  <p className="jp mt-1 text-lg font-semibold leading-7 text-[var(--ds-ink)]">{card.on.length ? card.on.join(" · ") : "—"}</p>
                </div>
                <div className="rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-surface)] px-3 py-2">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ds-ink-3)]">训读</p>
                  <p className="jp mt-1 text-lg font-semibold leading-7 text-[var(--ds-ink)]">{card.kun.length ? card.kun.join(" · ") : "—"}</p>
                </div>
              </div>
            ) : null}
            {card.usage.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ds-ink-3)]">读音要点</p>
                {card.usage.map((usage) => (
                  <p key={usage.base} className="mt-1.5 rounded-2xl px-3 py-2 text-sm leading-6" style={{ background: "var(--quiz-accent-soft)" }}>
                    <span className="jp mr-2 font-bold" style={{ color: "var(--quiz-accent)" }}>{usage.base}</span>
                    <span className="text-[var(--ds-ink)]">{usage.note}</span>
                  </p>
                ))}
              </div>
            )}
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ds-ink-3)]">词库例词</p>
              {card.examples.length === 0 && <p className="mt-1 text-sm text-[var(--ds-ink-2)]">词库里没有例词</p>}
              {card.examples.map((example) => (
                <p key={example.wordId} className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm leading-6">
                  <span className="jp text-base font-semibold text-[var(--ds-ink)]">{example.kanji}</span>
                  <span className="jp text-[var(--ds-ink-2)]">{example.kana}</span>
                  <span className="text-[var(--ds-ink-2)]">{example.meaning}</span>
                </p>
              ))}
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div><p className="text-base font-bold text-[var(--ds-ink)]">先想这个字的读音</p><p className="mt-1 text-xs text-[var(--ds-ink-2)]">回想音读、训读和你认识的例词</p></div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 lg:mx-auto lg:w-[min(900px,100%)]">
        {!revealed ? (
          <div className="flex h-16 gap-2">
            {Object.keys(pairs).length > 0 && <button type="button" onClick={() => { setPairs({}); setSelectedWord(null); }} className="focus-ring zoo-pop inline-flex h-16 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[var(--ds-line-2)] px-4 text-sm font-bold text-[var(--ds-ink-2)]"><RotateCcw size={16} />清空</button>}
            <button onClick={onReveal} style={{ background: "var(--quiz-accent)" }} className="focus-ring zoo-pop zoo-gloss inline-flex h-16 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold !text-[#2f3333]">
              <Eye size={18} /><span>{allConnected ? "核对连线" : "显示答案"}</span><span className="hidden text-xs font-semibold opacity-65 sm:inline">（按任意键）</span>
            </button>
          </div>
        ) : (
          <div className="zoo-rate-row grid h-16 grid-cols-[1.35fr_0.65fr_1.35fr_0.65fr] gap-2 sm:gap-3">
            {answerOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => onAnswer(option.value)}
                aria-keyshortcuts={answerHotkeyLabels[option.value]}
                className={`focus-ring zoo-pop h-16 min-w-0 rounded-2xl border ${option.secondary ? "border-[var(--ds-line-2)] px-1 text-sm font-semibold text-[var(--ds-ink-2)] hover:bg-[var(--ds-inset)]" : "quiz-accent-btn border-[var(--ds-line-2)] px-2 text-base font-bold"}`}
              >
                <span className={`block text-[11px] font-black text-[var(--ds-ink-3)] ${option.secondary ? "tracking-normal" : "tracking-[0.18em]"}`}>{answerHotkeyLabels[option.value]}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
