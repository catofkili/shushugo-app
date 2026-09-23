import { useEffect, type CSSProperties } from "react";
import { Eye } from "lucide-react";
import { JapaneseRuby } from "../../components/JapaneseRuby";
import { GrammarTermHint } from "../../components/GrammarTermHint";
import { answerHotkeyLabels, answerOptions } from "../word-study/word-study-utils";
import { patternPieces } from "../../lib/grammar-formation";
import { grammarKeyPoint } from "../../lib/grammar-key-points";
import { getGrammarTitleFuriganaByPattern, projectFurigana } from "../../lib/grammar-title-furigana";
import type { GrammarQuizAnswer, GrammarQuizCard } from "../../lib/grammar-quiz";
import { ExamplePlayButton } from "../word-study/WordStudyPanels";

/**
 * 一张语法卡的正反面 + 四档评分。**语法考题页和混合模式共用这一份** ——
 * 两处出的是同一副牌（同一套 grammar_progress / FSRS），长相和键位再分家
 * 就成了两个语法模式。
 *
 * 配色由调用方给：语法考题页用全应用的主色，混合模式用琥珀色，
 * 「这一张是语法不是单词」全靠颜色说话（见 QUIZ_ACCENT_*）。
 * 组件内部一律走 CSS 变量，Tailwind 的 hex 是静态字符串，塞不进变量。
 */
// 考题页跟全应用的主色走（换柚子商店的配色皮肤也跟着换）。以前写死 #81D8CF ——
// 那是主色还是青绿时候的值，主色换成绿之后考题页成了全应用唯一一块青色。
export const QUIZ_ACCENT_TEAL: CSSProperties = {
  "--quiz-accent": "var(--zoo-primary)",
  "--quiz-accent-ink": "var(--zoo-primary-deep)",
  "--quiz-accent-soft": "color-mix(in srgb, var(--zoo-primary) 12%, transparent)",
  "--quiz-accent-strong": "color-mix(in srgb, var(--zoo-primary) 20%, transparent)",
  "--quiz-accent-line": "color-mix(in srgb, var(--zoo-primary) 45%, transparent)"
} as CSSProperties;

/** 混合模式里语法卡的颜色。和接续标注的橙同一系，与单词卡的青绿一眼分得开。 */
export const QUIZ_ACCENT_AMBER: CSSProperties = {
  "--quiz-accent": "#F3B14D",
  "--quiz-accent-ink": "#B7791F",
  "--quiz-accent-soft": "rgba(243,177,77,0.12)",
  "--quiz-accent-strong": "rgba(243,177,77,0.20)",
  "--quiz-accent-line": "rgba(243,177,77,0.45)"
} as CSSProperties;

/**
 * 题面：逐条人工审过的句型，只保留不会直接送出中文答案的字词。
 * 翻面后显示完整句型；短接续提示才浮到 `～` 的头上，长接续统一留在下面的
 * 「接续」区。标注是绝对定位，不参加标题的排版高度，翻面不会把卡片撑变形。
 */
const MAX_INLINE_ATTACHMENT_CHARS = 20;

const hasInlineAttachment = (attachment: string | null): attachment is string => {
  if (!attachment) return false;
  return [...attachment].length <= MAX_INLINE_ATTACHMENT_CHARS;
};

const PatternLine = ({ card, revealed }: { card: GrammarQuizCard; revealed: boolean }) => {
  const furigana = getGrammarTitleFuriganaByPattern(card.pattern);
  if (!revealed) {
    return <JapaneseRuby text={card.question} furigana={projectFurigana(card.pattern, card.question, furigana)} />;
  }
  if (!hasInlineAttachment(card.attachment)) return <JapaneseRuby text={card.pattern} furigana={furigana} />;
  const pieces = patternPieces(card.pattern);
  return (
    <>
      {pieces.map((piece, index) => {
        const start = pieces.slice(0, index).reduce((total, current) => total + current.text.length, 0);
        return piece.slot ? (
          <span key={index} className="grammar-slot">
            <span className="grammar-slot__rt">{card.attachment}</span>
            {piece.text}
          </span>
        ) : (
          <JapaneseRuby
            key={index}
            text={piece.text}
            furigana={furigana
              ?.filter((annotation) => annotation.start >= start && annotation.start + annotation.length <= start + piece.text.length)
              .map((annotation) => ({ ...annotation, start: annotation.start - start }))}
          />
        );
      })}
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
        className={`grid min-h-0 place-items-center rounded-2xl px-3 py-4 text-center sm:p-6 lg:mx-auto lg:w-[min(900px,100%)] ${
          revealed ? "shrink-0 rounded-none border-b border-white/15 sm:min-h-32" : "flex-1 cursor-pointer"
        }`}
      >
        <div className="w-full min-w-0">
          <span className="rounded-sm border border-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white/60">
            {card.level}
          </span>
          {card.isNew && (
            <span
              className="ml-1.5 rounded-sm border px-1.5 py-0.5 text-[11px] font-bold"
              style={{ borderColor: "var(--quiz-accent-line)", color: "var(--quiz-accent-ink)" }}
            >
              新
            </span>
          )}
          <p
            className="jp-serif mt-2 break-words text-3xl font-semibold leading-tight sm:text-5xl lg:text-6xl"
          >
            <PatternLine card={card} revealed={revealed} />
          </p>
        </div>
      </div>

      {revealed && (
      <div
        data-word-scrollable="true"
        className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-4 text-center sm:p-6 lg:mx-auto lg:w-[min(900px,100%)]"
      >
          <div className="zoo-reveal-in w-full min-w-0">
            {/* 答案上半：接续（题面 `～` 上标的只是它的头一段） */}
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">接续</p>
            <p className="jp mx-auto mt-2 max-w-2xl break-words text-xl font-semibold leading-8 sm:text-2xl">
              {card.formation ? <GrammarTermHint text={card.formation} /> : "—"}
            </p>
            {/* 答案下半：中文意 */}
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-white/55">中文意</p>
            <p className="mx-auto mt-2 max-w-2xl break-words text-lg leading-7 text-white/85 sm:text-xl">
              {card.meaning || "—"}
            </p>
            {/* 抓手：这条最容易错的那一点。摆在答案之后、例句之前 ——
                翻面那两秒真正该带走的是它，不是再读一遍 49 字的说明。 */}
            {grammarKeyPoint(card.pattern) && (
              <p
                className="mx-auto mt-5 max-w-2xl break-words rounded-2xl px-3 py-2 text-base font-bold leading-7 sm:text-lg"
                style={{ background: "var(--quiz-accent-soft)", color: "var(--quiz-accent-ink)" }}
              >
                {grammarKeyPoint(card.pattern)}
              </p>
            )}
            <div className="mx-auto mt-5 max-w-2xl rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3 sm:px-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                例句
                {card.exampleJp && <ExamplePlayButton sentence={card.exampleJp} />}
              </p>
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
      </div>
      )}

      <div className="shrink-0 lg:mx-auto lg:w-[min(900px,100%)]">
        {!revealed ? (
          <button
            onClick={onReveal}
            style={{ background: "var(--quiz-accent)" }}
            className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold !text-[#2f3333]"
          >
            <Eye size={18} />
            <span>显示答案</span>
            <span className="kbd-hint text-xs font-semibold opacity-65">（按任意键）</span>
          </button>
        ) : (
          // 忘记/认识 是主键，模糊/熟知 摆一半宽、不填色 —— 和单词学习同一副骨架
          <div className="zoo-rate-row grid h-16 grid-cols-[1.35fr_0.65fr_1.35fr_0.65fr] gap-2 sm:gap-3">
            {answerOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => onAnswer(option.value)}
                aria-keyshortcuts={answerHotkeyLabels[option.value]}
                // 主次和单词卡一样：认识 = 本卡配色实心，忘记 = 暖色描边（rate-forgot 那条规则）
                className={`focus-ring zoo-pop rate-btn rate-${option.value} h-16 min-w-0 rounded-2xl border ${
                  option.secondary
                    ? "border-white/12 px-1 text-sm font-semibold text-white/60 hover:bg-white/[0.06]"
                    : option.value === "know"
                      ? "quiz-accent-solid px-2 text-base font-bold"
                      : "quiz-accent-btn border-white/20 px-2 text-base font-bold"
                }`}
              >
                <span
                  className={`kbd-hint block text-[11px] font-black text-white/45 ${
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
