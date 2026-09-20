import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import type { MatchingCard } from "../../lib/confusion-cards";
import { gradeMatching } from "../../lib/confusion-cards";
import type { WordAnswer } from "../../types/vocabulary";

/**
 * 疑难连线卡：左列词，右列题面（打乱）。点左边一个再点右边一个就是一条线；
 * 连对的锁住变色，连错的抖一下、计一次错。全连完自动按连错次数评分（gradeMatching），
 * 然后翻到反面看辨析稿，点「继续」才走下一张 —— 评分不让用户选，答案全露着时选分等于灌假数据。
 */
export const MATCH_ACCENT: CSSProperties = {
  "--quiz-accent": "#F2A7C8",
  "--quiz-accent-soft": "rgba(242,167,200,0.12)",
  "--quiz-accent-strong": "rgba(242,167,200,0.20)",
  "--quiz-accent-line": "rgba(242,167,200,0.45)"
} as CSSProperties;

interface Props {
  card: MatchingCard;
  /** 连完之后由父组件记账；参数是算好的档 */
  onFinished: (answer: WordAnswer, mistakes: number) => void;
  /** 反面看完，进下一张 */
  onContinue: () => void;
}

const shuffled = <T,>(items: T[], seed: string): T[] => {
  // 按组 key 定的伪随机：同一张卡在一次会话里重开右列顺序不变（撤销回来不会重新打乱）
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    const j = Math.abs(hash) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export const MatchingCardView = ({ card, onFinished, onContinue }: Props) => {
  const rightColumn = useMemo(() => shuffled(card.pairs, card.groupKey), [card]);
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [matched, setMatched] = useState<Set<number>>(() => new Set());
  const [mistakes, setMistakes] = useState(0);
  const [shakeId, setShakeId] = useState<number | null>(null);
  const finished = matched.size === card.pairs.length;

  useEffect(() => {
    if (finished) onFinished(gradeMatching(mistakes), mistakes);
    // onFinished 只在连完那一刻调一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!finished || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onContinue(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finished, onContinue]);

  const pickRight = (id: number) => {
    if (selectedLeft === null || matched.has(id)) return;
    if (id === selectedLeft) {
      setMatched((prev) => new Set(prev).add(id));
    } else {
      setMistakes((count) => count + 1);
      setShakeId(id);
      setTimeout(() => setShakeId(null), 350);
    }
    setSelectedLeft(null);
  };

  return (
    <div key={card.groupKey} style={MATCH_ACCENT} className="zoo-enter dictionary-card flex h-full min-h-0 flex-col gap-2 rounded-2xl px-3 pb-2 pt-3 sm:gap-3 sm:p-6">
      <div className="shrink-0 rounded-2xl border border-white/15 bg-[#464949] px-3 py-3 text-center sm:p-4 lg:mx-auto lg:w-[min(900px,100%)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">连线 · {card.label}</p>
        <p className="mt-1 text-sm text-white/60">{finished ? `连错 ${mistakes} 次` : "点左边一个词，再点右边它的意思"}</p>
      </div>

      <div data-word-scrollable="true" className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/15 bg-[#424545] p-3 sm:p-5 lg:mx-auto lg:w-[min(900px,100%)]">
        {!finished ? (
          <div className="grid grid-cols-[1fr_auto_1.4fr] gap-2 sm:gap-3">
            <div className="flex flex-col gap-2">
              {card.pairs.map((pair) => {
                const done = matched.has(pair.id);
                const active = selectedLeft === pair.id;
                return (
                  <button
                    key={pair.id}
                    disabled={done}
                    onClick={() => setSelectedLeft(active ? null : pair.id)}
                    className={`focus-ring rounded-2xl border px-3 py-3 text-left transition ${done ? "border-transparent bg-white/[0.04] text-white/35" : active ? "border-white/40" : "border-white/15 hover:bg-white/[0.06]"}`}
                    style={active ? { background: "var(--quiz-accent-strong)" } : undefined}
                  >
                    <span className="jp block text-xl font-semibold">{pair.surface}</span>
                    <span className="jp block text-xs text-white/55">{pair.kana}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col justify-around text-white/25"><ArrowRight size={16} /></div>
            <div className="flex flex-col gap-2">
              {rightColumn.map((pair) => {
                const done = matched.has(pair.id);
                return (
                  <button
                    key={pair.id}
                    disabled={done || selectedLeft === null}
                    onClick={() => pickRight(pair.id)}
                    className={`focus-ring rounded-2xl border px-3 py-3 text-left text-sm leading-6 transition ${done ? "border-transparent bg-white/[0.04] text-white/35" : "border-white/15 hover:bg-white/[0.06] disabled:hover:bg-transparent"} ${shakeId === pair.id ? "zoo-shake" : ""}`}
                  >
                    {pair.prompt}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="zoo-reveal-in mx-auto max-w-2xl text-left">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">辨析</p>
            <p className="mt-2 text-sm leading-7 text-white/85">{card.summary}</p>
            <div className="mt-4 flex flex-col gap-2">
              {card.pairs.map((pair) => (
                <div key={pair.id} className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                  <p className="flex items-baseline gap-2"><span className="jp text-lg font-semibold">{pair.surface}</span><span className="jp text-xs text-white/55">{pair.kana}</span><span className="text-sm text-white/70">{pair.prompt}</span></p>
                  {card.notes.get(String(pair.id)) && <p className="mt-1 text-sm leading-6 text-white/65">{card.notes.get(String(pair.id))}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 lg:mx-auto lg:w-[min(900px,100%)]">
        {finished ? (
          <button onClick={onContinue} style={{ background: "var(--quiz-accent)" }} className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold !text-[#2f3333]">
            <span>{mistakes === 0 ? "全对 · 继续" : mistakes === 1 ? "错了一条 · 继续" : "再看一遍 · 继续"}</span>
            <span className="text-xs font-semibold opacity-65">（回车）</span>
          </button>
        ) : (
          <div className="grid h-16 place-items-center rounded-2xl border border-white/12 text-sm text-white/45">
            {matched.size} / {card.pairs.length} 已连上
          </div>
        )}
      </div>
    </div>
  );
};
