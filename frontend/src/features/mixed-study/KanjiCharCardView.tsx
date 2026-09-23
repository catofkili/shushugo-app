import { useEffect, type CSSProperties } from "react";
import { Eye } from "lucide-react";
import { answerHotkeyLabels, answerOptions } from "../word-study/word-study-utils";
import type { KanjiCharCard } from "../../lib/kanji-char-cards";
import type { WordAnswer } from "../../types/vocabulary";

/**
 * 单独汉字卡：正面一个字，反面音读 / 训读 + 多音字判据 + 例词。
 * 键位和评分骨架照抄 GrammarCard（任意键翻面，V/B/N/M 评分），只换内容和颜色。
 */
export const KANJI_ACCENT: CSSProperties = {
  "--quiz-accent": "#B9A7F2",
  "--quiz-accent-soft": "rgba(185,167,242,0.12)",
  "--quiz-accent-strong": "rgba(185,167,242,0.20)",
  "--quiz-accent-line": "rgba(185,167,242,0.45)"
} as CSSProperties;

const LEVELS = ["N5", "N4", "N3", "N2", "N1", "无级"];

interface Props {
  card: KanjiCharCard;
  revealed: boolean;
  onReveal: () => void;
  onAnswer: (value: WordAnswer) => void;
}

export const KanjiCharCardView = ({ card, revealed, onReveal, onAnswer }: Props) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
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

  return (
    <div key={card.char} style={KANJI_ACCENT} className="zoo-enter dictionary-card flex h-full min-h-0 flex-col gap-2 rounded-2xl px-3 pb-2 pt-3 sm:gap-3 sm:p-6">
      <div
        onClick={() => !revealed && onReveal()}
        className={`grid min-h-0 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#464949] px-3 py-4 text-center sm:min-h-32 sm:p-6 lg:mx-auto lg:w-[min(900px,100%)] ${revealed ? "" : "cursor-pointer"}`}
      >
        <div>
          <span className="rounded-sm border border-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white/60">{LEVELS[card.levelRank] ?? "无级"}</span>
          <p className="jp-serif mt-2 text-7xl font-semibold leading-none sm:text-8xl">{card.char}</p>
        </div>
      </div>

      <div data-word-scrollable="true" className="grid min-h-0 flex-1 place-items-center overflow-y-auto rounded-2xl border border-white/15 bg-[#424545] p-4 text-center sm:p-6 lg:mx-auto lg:w-[min(900px,100%)]">
        {revealed ? (
          <div className="zoo-reveal-in w-full min-w-0">
            <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 text-left">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">音读</p>
                <p className="jp mt-1 text-lg font-semibold leading-7">{card.on.length ? card.on.join(" · ") : "—"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">训读</p>
                <p className="jp mt-1 text-lg font-semibold leading-7">{card.kun.length ? card.kun.join(" · ") : "—"}</p>
              </div>
            </div>
            {card.usage.length > 0 && (
              <div className="mx-auto mt-4 max-w-2xl text-left">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">什么时候读哪个</p>
                {card.usage.map((usage) => (
                  <p key={usage.base} className="mt-1.5 rounded-2xl px-3 py-2 text-sm leading-6" style={{ background: "var(--quiz-accent-soft)" }}>
                    <span className="jp mr-2 font-bold" style={{ color: "var(--quiz-accent)" }}>{usage.base}</span>
                    <span className="text-white/80">{usage.note}</span>
                  </p>
                ))}
              </div>
            )}
            <div className="mx-auto mt-4 max-w-2xl text-left">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">例词</p>
              {card.examples.length === 0 && <p className="mt-1 text-sm text-white/50">词库里没有例词</p>}
              {card.examples.map((example) => (
                <p key={example.wordId} className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm leading-6">
                  <span className="jp text-base font-semibold text-white/92">{example.kanji}</span>
                  <span className="jp text-white/60">{example.kana}</span>
                  <span className="text-white/70">{example.meaning}</span>
                </p>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-base font-bold text-white/72">先想读音</p>
            <p className="mt-1 text-xs text-white/45">音读、训读，以及你认识的带这个字的词</p>
          </div>
        )}
      </div>

      <div className="shrink-0 lg:mx-auto lg:w-[min(900px,100%)]">
        {!revealed ? (
          <button onClick={onReveal} style={{ background: "var(--quiz-accent)" }} className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold !text-[#2f3333]">
            <Eye size={18} /><span>显示答案</span><span className="text-xs font-semibold opacity-65">（按任意键）</span>
          </button>
        ) : (
          <div className="zoo-rate-row grid h-16 grid-cols-[1.35fr_0.65fr_1.35fr_0.65fr] gap-2 sm:gap-3">
            {answerOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => onAnswer(option.value)}
                aria-keyshortcuts={answerHotkeyLabels[option.value]}
                className={`focus-ring zoo-pop h-16 min-w-0 rounded-2xl border ${option.secondary ? "border-white/12 px-1 text-sm font-semibold text-white/60 hover:bg-white/[0.06]" : "quiz-accent-btn border-white/20 px-2 text-base font-bold"}`}
              >
                <span className={`block text-[11px] font-black text-white/45 ${option.secondary ? "tracking-normal" : "tracking-[0.18em]"}`}>{answerHotkeyLabels[option.value]}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
