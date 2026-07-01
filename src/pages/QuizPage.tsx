import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, RotateCcw } from "lucide-react";
import { GrammarTermHint } from "../components/GrammarTermHint";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { JLPTLevel } from "../types/grammar";
import { WordAnswer } from "../types/vocabulary";

interface QuizPageProps {
  onMistake?: (grammarId: string, questionId: string, prompt: string, userAnswer: string, correctAnswer: string, explanation: string) => void;
  selectedLevel: "All" | JLPTLevel;
}

interface GrammarStudyCard {
  id: number;
  pattern: string;
  meaning: string;
  prompt: string;
  formation: string;
  example: {
    jp: string;
    meaning: string;
  };
  notes: string;
  confusions: string[];
  level: string;
  score: number;
  importance: number;
}

interface GrammarStudyStats {
  total: number;
  knownForever: number;
  unseenCount: number;
  lowCount: number;
  masteredToday: number;
  reviewedToday: number;
  progressDone: number;
  progressTotal: number;
  studyDate: string;
}

interface GrammarSessionResponse {
  card: GrammarStudyCard | null;
  stats: GrammarStudyStats;
}

const answerOptions: { value: WordAnswer; label: string }[] = [
  { value: "forgot", label: "忘记" },
  { value: "fuzzy", label: "模糊" },
  { value: "know", label: "认识" },
  { value: "known_forever", label: "熟知" }
];

const StatPill = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-md border border-white/15 bg-[#81D8CF]/10 px-3 py-2">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</p>
    <p className="mt-1 text-sm font-semibold text-white/85">{value}</p>
  </div>
);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const QuizPage = ({ selectedLevel }: QuizPageProps) => {
  const [card, setCard] = useState<GrammarStudyCard | null>(null);
  const [stats, setStats] = useState<GrammarStudyStats | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      // 考题阶段:乱序抽题(mode=random),不走 SRS 推词算法
      const data = await request<GrammarSessionResponse>(`/api/grammar/next?level=${encodeURIComponent(selectedLevel)}&mode=random`);
      setCard(data.card);
      setStats(data.stats);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "语法复习读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [selectedLevel]);

  const answer = async (value: WordAnswer) => {
    if (!card || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const data = await request<GrammarSessionResponse>("/api/grammar/answer", {
        method: "POST",
        body: JSON.stringify({ grammarId: card.id, answer: value, level: selectedLevel })
      });
      // 答题仍记分(供复习板块按不熟悉度排序),但下一题改为随机抽取,不用 SRS 返回的卡
      setStats(data.stats);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-md border border-[#81D8CF]/40 bg-[#81D8CF]/20 p-6 text-white">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="mt-1 shrink-0" />
          <div>
            <p className="font-bold">语法练习暂时不可用</p>
            <p className="mt-2 text-sm text-white/70">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="grid min-h-[360px] place-items-center text-center text-white/75">正在读取下一题...</div>;
  }

  if (!card) {
    return (
      <div className="mx-auto max-w-3xl rounded-md border border-white/15 bg-[#464949] p-8 text-center">
        <CheckCircle2 className="mx-auto text-[#81D8CF]" size={34} />
        <h1 className="mt-4 text-2xl font-bold">这个等级练完了</h1>
        <p className="mt-2 text-white/62">该等级的语法点都已标记「熟知」。换个等级，或去「语法复习」回顾。</p>
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
    <div className="mx-auto flex h-[calc(100vh-13rem)] min-h-[520px] max-w-4xl flex-col justify-center lg:h-[calc(100vh-4rem)] lg:min-h-[600px]">
      <section className="dictionary-card relative flex h-full min-h-0 flex-col rounded-md p-5 sm:p-8">
        <div className="mb-5 flex shrink-0 items-center justify-between gap-3 border-b border-white/15 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/65">Grammar</p>
            <h1 className="mt-1 text-xl font-semibold">语法练习</h1>
          </div>
          <div className="flex items-center gap-2">
            {stats && <span className="rounded-sm border border-white/15 px-2 py-1 text-xs text-white/70">{stats.progressDone}/{stats.progressTotal}</span>}
            <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/70">{card.level}</span>
            <button
              onClick={load}
              disabled={submitting}
              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15 disabled:opacity-50"
              title="刷新"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>

        {stats && (
          <div className="mb-4 grid gap-2 sm:grid-cols-4">
            <StatPill label="progress" value={`${stats.progressDone}/${stats.progressTotal}`} />
            <StatPill label="low" value={stats.lowCount} />
            <StatPill label="unseen" value={stats.unseenCount} />
            <StatPill label="today" value={stats.reviewedToday} />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="relative grid min-h-28 shrink-0 place-items-center rounded-md border border-white/15 bg-[#464949] p-5 text-center">
            <span className="absolute right-3 top-3 max-w-28 truncate text-[10px] font-semibold leading-none text-white/28">
              score {card.score}
            </span>
            <div className="w-full px-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">题目</p>
              <p className="jp-serif mt-3 text-4xl font-semibold leading-tight sm:text-6xl">
                <JapaneseRuby text={card.pattern} />
              </p>
              {card.prompt && card.prompt !== card.pattern && (
                <p className="jp mt-4 text-lg leading-8 text-white/70"><JapaneseRuby text={card.prompt} /></p>
              )}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto rounded-md border border-white/15 bg-[#424545] p-6 text-center">
            {revealed ? (
              <div className="w-full">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Answer</p>
                <p className="mx-auto mt-4 max-w-2xl text-2xl font-semibold leading-9 text-white/88">{card.meaning}</p>
                <div className="jp mx-auto mt-5 max-w-2xl rounded-md border border-white/15 bg-[#373b3b] px-4 py-3 text-lg leading-8 text-white/80">
                  <GrammarTermHint text={card.formation || card.prompt} />
                </div>
                <div className="mx-auto mt-5 max-w-2xl rounded-md border border-white/15 bg-[#373b3b] p-4 text-left">
                  <p className="jp text-lg leading-8"><JapaneseRuby text={card.example.jp} /></p>
                  <p className="mt-2 text-sm leading-6 text-white/65">{card.example.meaning}</p>
                </div>
                {card.notes && <p className="mx-auto mt-4 max-w-2xl whitespace-pre-wrap text-sm leading-7 text-white/66">{card.notes}</p>}
              </div>
            ) : (
              <div>
                <p className="text-2xl font-semibold text-white/70">答案已隐藏</p>
                <p className="mt-3 text-sm text-white/55">看到日语结构，先回忆中文释义、接续和例句</p>
              </div>
            )}
          </div>

          <div className="h-16">
            {!revealed ? (
              <button
                onClick={() => setRevealed(true)}
                className="focus-ring inline-flex h-16 w-full items-center justify-center gap-2 rounded-md bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]"
              >
                <Eye size={18} />
                显示答案
              </button>
            ) : (
              <div className="grid h-16 grid-cols-4 gap-3">
                {answerOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => answer(option.value)}
                    disabled={submitting}
                    className="focus-ring h-16 rounded-md border border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15 disabled:opacity-50"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
