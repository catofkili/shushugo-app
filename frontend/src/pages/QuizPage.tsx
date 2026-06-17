import { useEffect, useState } from "react";
import { BookMarked, CheckCircle2, RotateCcw, Star, XCircle } from "lucide-react";
import { getGrammarMistakes, getGrammarSession, GrammarMistakeItem, GrammarStudyCard, GrammarStudyStats, StudyAnswer, submitGrammarAnswer, toggleFavorite } from "../lib/api";
import { triggerMemoryHaptic } from "../lib/haptics";
import { JLPTLevel } from "../types/grammar";

interface QuizPageProps {
  onMistake?: (grammarId: string, questionId: string, prompt: string, userAnswer: string, correctAnswer: string, explanation: string) => void;
  selectedLevel: "All" | JLPTLevel;
  onOpenMistakes?: () => void;
}

const answerOptions: { value: StudyAnswer; label: string }[] = [
  { value: "forgot", label: "忘记" },
  { value: "fuzzy", label: "模糊" },
  { value: "know", label: "认识" },
  { value: "known_forever", label: "熟知" }
];

const StatPill = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border border-white/15 bg-[#81D8CF]/10 px-3 py-2">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</p>
    <p className="mt-1 text-sm font-semibold text-white/85">{value}</p>
  </div>
);

export const QuizPage = ({ selectedLevel, onOpenMistakes }: QuizPageProps) => {
  const [card, setCard] = useState<GrammarStudyCard | null>(null);
  const [stats, setStats] = useState<GrammarStudyStats | null>(null);
  const [mistakes, setMistakes] = useState<GrammarMistakeItem[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    try {
      const data = getGrammarSession(selectedLevel);
      setCard(data.card);
      setStats(data.stats);
      setMistakes(getGrammarMistakes(3));
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
      setMistakes(getGrammarMistakes(3));
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
      <div className="mx-auto max-w-3xl rounded-2xl border border-white/15 bg-[#464949] p-8 text-center">
        <CheckCircle2 className="mx-auto text-[#81D8CF]" size={34} />
        <h1 className="mt-4 text-2xl font-bold">今日语法清空</h1>
        <p className="mt-2 text-white/62">没有到期语法点了。</p>
        {stats && (
          <div className="mx-auto mt-5 grid max-w-lg grid-cols-3 gap-2">
            <StatPill label="done" value={`${stats.progressDone}/${stats.progressTotal}`} />
            <StatPill label="low" value={stats.lowCount} />
            <StatPill label="today" value={stats.reviewedToday} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[520px] max-w-3xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Grammar Review</p>
          <h1 className="mt-1 text-2xl font-bold">语法智能复习</h1>
        </div>
        <button onClick={load} className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-[#81D8CF]/10" title="刷新">
          <RotateCcw size={17} />
        </button>
      </div>

      {stats && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_minmax(160px,1.35fr)]">
          <StatPill label="progress" value={`${stats.progressDone}/${stats.progressTotal}`} />
          <StatPill label="low" value={stats.lowCount} />
          <StatPill label="unseen" value={stats.unseenCount} />
          <StatPill label="today" value={stats.reviewedToday} />
          <button
            onClick={onOpenMistakes}
            className="focus-ring rounded-xl border border-white/15 bg-[#81D8CF]/10 px-3 py-2 text-left hover:bg-[#81D8CF]/15"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">mistakes</p>
              <BookMarked size={15} className="text-[#81D8CF]" />
            </div>
            <p className="mt-1 text-sm font-semibold text-white/85">{stats.mistakeCount} 条</p>
            {mistakes[0] && <p className="mt-1 truncate text-[11px] text-white/48">{mistakes[0].title}</p>}
          </button>
        </div>
      )}

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
              <p className="jp-serif text-5xl font-semibold leading-tight">{card.pattern}</p>
              <p className="mt-5 text-xl leading-8 text-white/82">{card.meaning}</p>
              <p className="jp mt-5 rounded-2xl border border-white/15 bg-[#373b3b] px-4 py-3 text-lg leading-8 text-white/80">{card.formation}</p>
              <div className="mt-5 rounded-2xl border border-white/15 bg-[#373b3b] p-4 text-left">
                <p className="jp text-lg leading-8">{card.example.jp}</p>
                <p className="mt-2 text-sm leading-6 text-white/65">{card.example.meaning}</p>
              </div>
              {card.notes && <p className="mt-4 text-sm leading-7 text-white/66">{card.notes}</p>}
              {card.confusions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {card.confusions.map((item) => (
                    <span key={item} className="rounded-sm border border-white/15 bg-[#81D8CF]/10 px-3 py-2 text-sm text-white/72">{item}</span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Prompt</p>
              <p className="mt-4 text-2xl font-semibold leading-9 text-white/88">{card.prompt}</p>
              <p className="jp-serif mt-6 text-5xl font-semibold leading-tight text-white/70">{card.pattern}</p>
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
            <XCircle size={18} />
            显示答案
          </button>
        )}
      </section>
    </div>
  );
};
