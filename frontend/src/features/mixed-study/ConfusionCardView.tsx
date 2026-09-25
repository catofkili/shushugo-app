import { useEffect, type CSSProperties } from "react";
import { Eye } from "lucide-react";
import { answerHotkeyLabels, answerOptions } from "../word-study/word-study-utils";
import type { MatchingCard } from "../../lib/confusion-cards";
import type { WordAnswer } from "../../types/vocabulary";

export const MATCH_ACCENT: CSSProperties = {
  "--quiz-accent": "#F2A7C8",
  "--quiz-accent-soft": "rgba(242,167,200,0.12)",
  "--quiz-accent-strong": "rgba(242,167,200,0.20)",
  "--quiz-accent-line": "rgba(242,167,200,0.45)"
} as CSSProperties;

interface Props {
  card: MatchingCard;
  revealed: boolean;
  onReveal: () => void;
  onAnswer: (value: WordAnswer) => void;
}

/** A genuine recall card: retrieve the distinction, reveal its handwritten explanation, then self-rate. */
export const ConfusionCardView = ({ card, revealed, onReveal, onAnswer }: Props) => {
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

  return (
    <div key={card.groupKey} style={MATCH_ACCENT} className="zoo-enter dictionary-card flex h-full min-h-0 flex-col gap-2 rounded-2xl px-3 pb-2 pt-3 sm:gap-3 sm:p-6">
      <div className="shrink-0 rounded-2xl border border-white/15 bg-[#464949] px-3 py-3 text-center sm:p-4 lg:mx-auto lg:w-[min(900px,100%)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">辨析卡 · {card.label}</p>
        <p className="mt-1 text-sm text-white/60">{revealed ? "按刚才回想的准确程度评分" : "先回想这组词的区别，再翻面核对"}</p>
      </div>

      <div data-word-scrollable="true" className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/15 bg-[#424545] p-4 sm:p-6 lg:mx-auto lg:w-[min(900px,100%)]">
        {!revealed ? (
          <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center py-4 text-center">
            <p className="text-xs font-bold tracking-[0.16em] text-white/45">先回想，再翻面</p>
            <p className="mt-2 text-sm leading-6 text-white/65">说出每个词的意思和常见搭配，想清楚它们不能互换的地方。</p>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
              {card.members.map((member) => (
                <div key={member.id} className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 text-left">
                  <p className="jp text-xl font-bold text-white">{member.surface}</p>
                  <p className="jp mt-0.5 text-sm text-white/55">{member.kana}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="zoo-reveal-in mx-auto w-full max-w-2xl py-1 text-left">
            <div className="rounded-2xl border border-[color:var(--quiz-accent-line)] bg-[color:var(--quiz-accent-soft)] px-4 py-3">
              <p className="text-[11px] font-bold tracking-[0.16em] text-white/55">判断要点</p>
              <p className="mt-1.5 text-sm leading-6 text-white/90">{card.overview}</p>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {card.members.map((member) => (
                <div key={member.id} className="grid grid-cols-[minmax(84px,0.34fr)_minmax(0,1fr)] gap-x-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:px-4">
                  <div className="min-w-0">
                    <p className="jp break-words text-lg font-bold leading-6 text-white">{member.surface}</p>
                    <p className="jp mt-0.5 break-words text-xs leading-5 text-white/50">{member.kana}</p>
                  </div>
                  <p className="min-w-0 self-center text-sm leading-6 text-white/78">{member.note || "此组词的用法见总述。"}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 lg:mx-auto lg:w-[min(900px,100%)]">
        {!revealed ? (
          <button onClick={onReveal} style={{ background: "var(--quiz-accent)" }} className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold !text-[#2f3333]">
            <Eye size={18} /><span>显示辨析</span><span className="text-xs font-semibold opacity-65">（按任意键）</span>
          </button>
        ) : (
          <div className="zoo-rate-row grid h-16 grid-cols-[1.35fr_0.65fr_1.35fr_0.65fr] gap-2 sm:gap-3">
            {answerOptions.map((option) => (
              <button key={option.value} onClick={() => onAnswer(option.value)} aria-keyshortcuts={answerHotkeyLabels[option.value]} className={`focus-ring zoo-pop h-16 min-w-0 rounded-2xl border ${option.secondary ? "border-white/12 px-1 text-sm font-semibold text-white/60 hover:bg-white/[0.06]" : "quiz-accent-btn border-white/20 px-2 text-base font-bold"}`}>
                <span className={`block text-[10px] font-black text-white/45 ${option.secondary ? "tracking-normal" : "tracking-[0.18em]"}`}>{answerHotkeyLabels[option.value]}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
