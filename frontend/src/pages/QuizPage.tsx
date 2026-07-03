import { useEffect, useRef, useState, type TouchEvent, type WheelEvent } from "react";
import { CheckCircle2, Eye, RotateCcw, Star } from "lucide-react";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { getGrammarSession, GrammarStudyCard, GrammarStudyStats, StudyAnswer, submitGrammarAnswer, toggleFavorite } from "../lib/api";
import { answerOptions } from "../features/word-study/word-study-utils";
import { triggerMemoryHaptic } from "../lib/haptics";
import { JLPTLevel } from "../types/grammar";

interface QuizPageProps {
  onMistake?: (grammarId: string, questionId: string, prompt: string, userAnswer: string, correctAnswer: string, explanation: string) => void;
  selectedLevel: "All" | JLPTLevel;
}

const StatPill = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border border-white/15 bg-[#81D8CF]/10 px-3 py-2">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</p>
    <p className="mt-1 text-sm font-semibold text-white/85">{value}</p>
  </div>
);

const StatsDrawer = ({ stats }: { stats: GrammarStudyStats | null }) => {
  const [open, setOpen] = useState(false);
  const [motion, setMotion] = useState<"opening" | "closing" | "">("");
  const touchStartY = useRef<number | null>(null);

  const show = () => {
    setOpen(true);
    setMotion("opening");
  };

  const hide = () => {
    setOpen(false);
    setMotion("closing");
  };

  useEffect(() => {
    if (!motion) return;
    const timer = window.setTimeout(() => setMotion(""), 260);
    return () => window.clearTimeout(timer);
  }, [motion]);

  const handleWheel = (event: WheelEvent) => {
    if (Math.abs(event.deltaY) < 32) return;
    if (event.deltaY > 0) show();
    if (event.deltaY < 0) hide();
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const start = touchStartY.current;
    touchStartY.current = null;
    if (start == null) return;
    const delta = event.changedTouches[0].clientY - start;
    if (delta > 42) show();
    if (delta < -42) hide();
  };

  return (
    <div
      className="fixed bottom-3 left-1/2 z-30 w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2"
      onWheel={handleWheel}
      onTouchStart={(event) => {
        touchStartY.current = event.touches[0].clientY;
      }}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={`pointer-events-none absolute inset-x-6 bottom-0 h-16 rounded-2xl bg-[#81D8CF]/12 blur-sm transition-all duration-300 ${
          motion === "opening" ? "translate-y-2 opacity-70" : motion === "closing" ? "-translate-y-2 opacity-45" : "opacity-0"
        }`}
      />
      <div
        className={`relative overflow-hidden rounded-2xl border border-white/15 bg-[#343838]/96 shadow-2xl backdrop-blur transition-[max-height,transform,border-color] duration-300 ease-out ${
          open ? "max-h-48 border-[#81D8CF]/30" : "max-h-8"
        }`}
      >
        <button
          onClick={() => (open ? hide() : show())}
          className="focus-ring flex h-8 w-full items-center justify-center"
          title={open ? "收起统计" : "展开统计"}
        >
          <span
            className={`h-1.5 w-12 rounded-full bg-[#81D8CF]/55 transition-all duration-300 ${
              open ? "w-16 bg-[#81D8CF]/85" : ""
            }`}
          />
        </button>
        {stats && (
          <div className={`grid gap-2 px-3 pb-3 pt-1 transition-all duration-300 sm:grid-cols-4 ${open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
            <StatPill label="进度" value={`${stats.progressDone}/${stats.progressTotal}`} />
            <StatPill label="生疏" value={stats.lowCount} />
            <StatPill label="未见" value={stats.unseenCount} />
            <StatPill label="今日" value={stats.reviewedToday} />
          </div>
        )}
      </div>
    </div>
  );
};

export const QuizPage = ({ selectedLevel }: QuizPageProps) => {
  const [card, setCard] = useState<GrammarStudyCard | null>(null);
  const [stats, setStats] = useState<GrammarStudyStats | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    try {
      const data = getGrammarSession(selectedLevel);
      setCard(data.card);
      setStats(data.stats);
      setRevealed(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "语法复习读取失败");
    }
  };

  useEffect(() => {
    load();
  }, [selectedLevel]);

  useEffect(() => {
    setRevealed(false);
  }, [card?.id]);

  const answer = (value: StudyAnswer) => {
    if (!card) return;
    triggerMemoryHaptic(value);
    try {
      const data = submitGrammarAnswer(card.id, value, selectedLevel);
      setCard(data.card);
      setStats(data.stats);
      setRevealed(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    }
  };

  const toggleCardFavorite = () => {
    if (!card) return;
    try {
      const result = toggleFavorite("grammar", card.key);
      setCard({ ...card, isFavorite: result.isFavorite });
    } catch (err) {
      setError(err instanceof Error ? err.message : "收藏失败");
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-[#81D8CF]/40 bg-[#81D8CF]/20 p-6 text-white">
        <p className="font-bold">语法练习暂时不可用</p>
        <p className="mt-2 text-sm text-white/70">{error}</p>
      </div>
    );
  }

  if (!card) {
    return (
      <>
        <div className="mx-auto max-w-3xl rounded-2xl border border-white/15 bg-[#464949] p-8 text-center">
          <CheckCircle2 className="mx-auto text-[#81D8CF]" size={34} />
          <h1 className="mt-4 text-2xl font-bold">今日语法清空</h1>
          <p className="mt-2 text-white/62">没有到期语法点了。</p>
        </div>
        <StatsDrawer stats={stats} />
      </>
    );
  }

  return (
    <div className="mx-auto flex min-h-[520px] max-w-3xl flex-col gap-4 pb-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Grammar Review</p>
          <h1 className="mt-1 text-2xl font-bold">语法智能复习</h1>
        </div>
        <button onClick={load} className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-[#81D8CF]/10" title="刷新">
          <RotateCcw size={17} />
        </button>
      </div>

      <section key={card.id} className="dictionary-card flex min-h-0 flex-1 flex-col rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-4">
          <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/70">{card.level}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleCardFavorite}
              className={`focus-ring grid h-9 w-9 place-items-center rounded-2xl border border-white/20 ${card.isFavorite ? "bg-[#81D8CF] text-[#343838]" : "bg-[#81D8CF]/10 text-white/72"}`}
              title={card.isFavorite ? "取消收藏" : "收藏语法"}
            >
              <Star size={16} fill={card.isFavorite ? "currentColor" : "none"} />
            </button>
            <span className="rounded-sm bg-[#81D8CF]/15 px-2 py-1 text-xs font-bold text-white/70">score {card.score}</span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto py-6 text-center">
          {revealed ? (
            <div className="w-full">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Answer</p>
              <p className="mt-4 text-2xl font-semibold leading-9 text-white/88">{card.meaning}</p>
              <div className="mt-5 rounded-2xl border border-white/15 bg-[#373b3b] p-4 text-left">
                <p className="jp text-lg leading-8"><JapaneseRuby text={card.example.jp} /></p>
                <p className="mt-2 text-sm leading-6 text-white/65">{card.example.meaning}</p>
              </div>
              {card.notes && <p className="mt-4 text-sm leading-7 text-white/66">{card.notes}</p>}
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">题目</p>
              <p className="jp-serif mt-4 text-5xl font-semibold leading-tight text-white/88"><JapaneseRuby text={card.pattern} /></p>
              {card.prompt && card.prompt !== card.pattern && (
                <p className="jp mt-5 text-xl leading-8 text-white/70"><JapaneseRuby text={card.prompt} /></p>
              )}
            </div>
          )}
        </div>

        {revealed ? (
          <div className="grid h-16 grid-cols-4 gap-3">
            {answerOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => answer(option.value)}
                className="focus-ring h-16 rounded-2xl border border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <button onClick={() => setRevealed(true)} className="focus-ring inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]">
            <Eye size={18} />
            显示答案
          </button>
        )}
      </section>
      <StatsDrawer stats={stats} />
    </div>
  );
};
