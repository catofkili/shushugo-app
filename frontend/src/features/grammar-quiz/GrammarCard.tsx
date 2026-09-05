import { useEffect, type CSSProperties } from "react";
import { Eye } from "lucide-react";
import { JapaneseRuby } from "../../components/JapaneseRuby";
import { answerHotkeyLabels, answerOptions } from "../word-study/word-study-utils";
import { patternPieces } from "../../lib/grammar-formation";
import type { GrammarQuizAnswer, GrammarQuizCard } from "../../lib/grammar-quiz";

/**
 * 一张语法卡的正反面 + 四档评分。**语法考题页和混合模式共用这一份** ——
 * 两处出的是同一副牌（同一套 grammar_progress / FSRS），长相和键位再分家
 * 就成了两个语法模式。
 *
 * 配色由调用方给：语法考题页用全应用的主色，混合模式用琥珀色，
 * 「这一张是语法不是单词」全靠颜色说话（见 QUIZ_ACCENT_*）。
 * 组件内部一律走 CSS 变量，Tailwind 的 hex 是静态字符串，塞不进变量。
 */
export const QUIZ_ACCENT_TEAL: CSSProperties = {
  "--quiz-accent": "#81D8CF",
  "--quiz-accent-soft": "rgba(129,216,207,0.10)",
  "--quiz-accent-strong": "rgba(129,216,207,0.16)",
  "--quiz-accent-line": "rgba(129,216,207,0.45)"
} as CSSProperties;

/** 混合模式里语法卡的颜色。和接续标注的橙同一系，与单词卡的青绿一眼分得开。 */
export const QUIZ_ACCENT_AMBER: CSSProperties = {
  "--quiz-accent": "#F3B14D",
  "--quiz-accent-soft": "rgba(243,177,77,0.12)",
  "--quiz-accent-strong": "rgba(243,177,77,0.20)",
  "--quiz-accent-line": "rgba(243,177,77,0.45)"
} as CSSProperties;

/**
 * 题面：句型本身。翻面后把接续标在每个 `～` 的头上 ——
 * `～` 是这张卡真正的坑，标在坑边上比写在下面省掉「对号入座」那一步。
 * 标不准的（判据见 lib/grammar-formation.ts）就不标，只留下面那行完整接续。
 */
const PatternLine = ({ card, revealed }: { card: GrammarQuizCard; revealed: boolean }) => {
  if (!revealed || !card.attachment) return <>{card.pattern}</>;
  return (
    <>
      {patternPieces(card.pattern).map((piece, index) => (
        piece.slot ? (
          <span key={index} className="grammar-slot">
            <span className="grammar-slot__rt">{card.attachment}</span>
            {piece.text}
          </span>
        ) : (
          <span key={index}>{piece.text}</span>
        )
      ))}
    </>
  );
};

interface GrammarCardProps {
  card: GrammarQuizCard;
  revealed: boolean;
  onReveal: () => void;
  onAnswer: (value: GrammarQuizAnswer) => void;
  accent?: CSSProperties;
}

export const GrammarCard = ({ card, revealed, onReveal, onAnswer, accent = QUIZ_ACCENT_TEAL }: GrammarCardProps) => {
  // 键盘：任意普通键翻面，翻面后 V/B/N/M 评分。和单词学习一致。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (!revealed) {
        if (event.key.length === 1 || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onReveal();
        }
        return;
      }
      const hit = answerOptions.find(
        (option) => answerHotkeyLabels[option.value].toLowerCase() === event.key.toLowerCase()
      );
      if (hit) {
        event.preventDefault();
        onAnswer(hit.value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer, onReveal, revealed]);

  return (
    <div
      key={card.id}
      style={accent}
      className="zoo-enter dictionary-card flex h-full min-h-0 flex-col gap-2 rounded-2xl px-3 pb-2 pt-3 sm:gap-3 sm:p-6"
    >
      <div
        onClick={() => !revealed && onReveal()}
        className={`grid min-h-0 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#464949] px-3 py-4 text-center sm:min-h-32 sm:p-6 lg:mx-auto lg:w-[min(900px,100%)] ${
          revealed ? "" : "cursor-pointer"
        }`}
      >
        <div className="w-full min-w-0">
          <span className="rounded-sm border border-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white/60">
            {card.level}
          </span>
          {card.isNew && (
            <span
              className="ml-1.5 rounded-sm border px-1.5 py-0.5 text-[11px] font-bold"
              style={{ borderColor: "var(--quiz-accent-line)", color: "var(--quiz-accent)" }}
            >
              新
            </span>
          )}
          <p
            className={`jp-serif mt-2 break-words text-3xl font-semibold leading-tight sm:text-5xl lg:text-6xl ${
              revealed && card.attachment ? "grammar-pattern--annotated" : ""
            }`}
          >
            <PatternLine card={card} revealed={revealed} />
          </p>
        </div>
      </div>

      <div
        data-word-scrollable="true"
        className="grid min-h-0 flex-1 place-items-center overflow-y-auto rounded-2xl border border-white/15 bg-[#424545] p-4 text-center sm:p-6 lg:mx-auto lg:w-[min(900px,100%)]"
      >
        {revealed ? (
          <div className="zoo-reveal-in w-full min-w-0">
            {/* 答案上半：接续（题面 `～` 上标的只是它的头一段） */}
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">接续</p>
            <p className="jp mx-auto mt-2 max-w-2xl break-words text-xl font-semibold leading-8 sm:text-2xl">
              {card.formation || "—"}
            </p>
            {/* 答案下半：中文意 */}
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-white/55">中文意</p>
            <p className="mx-auto mt-2 max-w-2xl break-words text-lg leading-7 text-white/85 sm:text-xl">
              {card.meaning || "—"}
            </p>
            <div className="mx-auto mt-5 max-w-2xl rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3 sm:px-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">例句</p>
              <p className="jp mt-2 break-words text-lg font-semibold leading-8 text-white/90 sm:text-xl">
                <JapaneseRuby
                  text={card.exampleJp || "—"}
                  furigana={card.exampleFurigana}
                  tokenLengths={card.exampleTokens}
                  tokenLemmas={card.exampleLemmas}
                />
              </p>
              {card.exampleMeaning && (
                <p className="mt-1 break-words text-sm leading-6 text-white/60">{card.exampleMeaning}</p>
              )}
            </div>
            {card.forgotCount > 0 && (
              <p className="mt-4 text-xs text-white/40">这条你答错过 {card.forgotCount} 次</p>
            )}
          </div>
        ) : (
          <div className="text-center">
            <p className="text-base font-bold text-white/72">答案已隐藏</p>
            <p className="mt-1 text-xs text-white/45">先回忆接续和意思</p>
          </div>
        )}
      </div>

      <div className="shrink-0 lg:mx-auto lg:w-[min(900px,100%)]">
        {!revealed ? (
          <button
            onClick={onReveal}
            style={{ background: "var(--quiz-accent)" }}
            className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold !text-[#2f3333]"
          >
            <Eye size={18} />
            <span>显示答案</span>
            <span className="text-xs font-semibold opacity-65">（按任意键）</span>
          </button>
        ) : (
          // 忘记/认识 是主键，模糊/熟知 摆一半宽、不填色 —— 和单词学习同一副骨架
          <div className="zoo-rate-row grid h-16 grid-cols-[1.35fr_0.65fr_1.35fr_0.65fr] gap-2 sm:gap-3">
            {answerOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => onAnswer(option.value)}
                aria-keyshortcuts={answerHotkeyLabels[option.value]}
                className={`focus-ring zoo-pop h-16 min-w-0 rounded-2xl border ${
                  option.secondary
                    ? "border-white/12 px-1 text-sm font-semibold text-white/60 hover:bg-white/[0.06]"
                    : "quiz-accent-btn border-white/20 px-2 text-base font-bold"
                }`}
              >
                <span
                  className={`block text-[10px] font-black text-white/45 ${
                    option.secondary ? "tracking-normal" : "tracking-[0.18em]"
                  }`}
                >
                  {answerHotkeyLabels[option.value]}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
