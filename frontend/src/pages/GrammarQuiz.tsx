import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ListOrdered, Plus, Undo2 } from "lucide-react";
import type { JLPTLevel } from "../types/grammar";
import { GrammarCard } from "../features/grammar-quiz/GrammarCard";
import {
  extendGrammarQuizPlan,
  getGrammarQuizSession,
  grammarQuizRanking,
  submitGrammarQuizAnswer,
  undoLastGrammarQuizAnswer,
  GRAMMAR_ENCORE_SIZE,
  type GrammarQuizAnswer,
  type GrammarQuizSession
} from "../lib/grammar-quiz";

interface GrammarQuizProps {
  /** 进来时用哪个等级。列表页选「全部等级」时给 null，由这里自己挑一个并把选择器亮出来。 */
  initialLevel: JLPTLevel | null;
  onBack: () => void;
}

const LEVELS: JLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

/**
 * 语法考题：题面给句型，翻面给接续 + 中文意。
 *
 * 和单词学习共用同一副骨架**和同一套内核**：FSRS 到期集选题、四档评分、
 * 没毕业就当天隔几张重刷、每日新条目配额。卡片本身在 features/grammar-quiz/GrammarCard，
 * 混合模式（单词里插播语法）出的是同一张卡、同一套键位，只是换个颜色。
 */
export const GrammarQuiz = ({ initialLevel, onBack }: GrammarQuizProps) => {
  // 考题一次只考一个等级：备考是按等级来的，五个等级混在一起就没有「今天这一档
  // 还剩多少」可言了。所以等级选择器长在这里，而不是沿用列表页那个可以选「全部」的筛选。
  const [level, setLevel] = useState<JLPTLevel>(initialLevel ?? "N5");
  const [session, setSession] = useState<GrammarQuizSession | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [rankingRevision, setRankingRevision] = useState(0);

  useEffect(() => {
    setSession(getGrammarQuizSession(level));
    setRevealed(false);
    setShowRanking(false);
  }, [level]);

  const answer = useCallback((value: GrammarQuizAnswer) => {
    if (!session?.card) return;
    setSession(submitGrammarQuizAnswer(level, session.card.id, value));
    setRevealed(false);
    setRankingRevision((v) => v + 1);
  }, [level, session]);

  const encore = useCallback(() => {
    setSession(extendGrammarQuizPlan(level));
    setRevealed(false);
    setShowRanking(false);
  }, [level]);

  const undo = useCallback(() => {
    if (!session?.canUndo) return;
    setSession(undoLastGrammarQuizAnswer(level));
    setRevealed(false);
    setShowRanking(false);
    setRankingRevision((v) => v + 1);
  }, [level, session?.canUndo]);

  const ranking = useMemo(
    () => (showRanking ? grammarQuizRanking(level) : []),
    [level, showRanking, rankingRevision]
  );

  const card = session?.card ?? null;
  const done = session?.done ?? 0;
  const total = session?.total ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="word-study-shell mx-auto flex max-w-4xl flex-col justify-center lg:max-w-[1200px]">
      <div className="mb-2 flex min-w-0 items-center gap-2 lg:mb-3">
        <button
          onClick={onBack}
          className="focus-ring inline-flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-white/20 bg-[#81D8CF]/10 px-3 text-sm font-bold hover:bg-[#81D8CF]/15"
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="min-w-0">
          <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.22em] text-white/65">GRAMMAR QUIZ</p>
          <h1 className="truncate text-lg font-semibold leading-tight">
            {level} 语法考题
          </h1>
        </div>
        <button
          onClick={() => setShowRanking((open) => !open)}
          title="按答错次数排序"
          className={`focus-ring ml-auto inline-flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-white/20 px-3 text-sm font-bold ${
            showRanking ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15"
          }`}
        >
          <ListOrdered size={16} />
          <span className="hidden sm:inline">错得最多</span>
        </button>
        <button
          onClick={undo}
          disabled={!session?.canUndo}
          title={session?.canUndo ? "回到刚答的那条并撤销那次作答" : "今天还没有可撤销的作答"}
          aria-label="上一个"
          className="focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15 disabled:opacity-35"
        >
          <Undo2 size={16} />
        </button>
      </div>

      {/* 等级选择器。每个等级各算各的当日计划，切回来接着到期的那批。 */}
      <div className="mb-2 flex flex-wrap gap-1.5 lg:mx-auto lg:w-[min(900px,100%)]">
        {LEVELS.map((item) => (
          <button
            key={item}
            onClick={() => setLevel(item)}
            className={`focus-ring rounded-xl border px-3 py-1.5 text-xs font-bold ${
              item === level
                ? "border-[#81D8CF] bg-[#81D8CF] !text-[#2f3333]"
                : "border-white/15 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {/* 今日进度：过关 = 下次到期排到了明天以后（和单词那边同一个判据） */}
      <div className="mb-2 lg:mx-auto lg:w-[min(900px,100%)]">
        <div className="flex items-center justify-between text-xs font-semibold text-white/55">
          <span>今天 {done} / {total}</span>
          <span>新学 {session?.newDone ?? 0} / {session?.newQuota ?? 0}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#81D8CF] transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {showRanking ? (
        <div className="dictionary-card flex h-full min-h-0 flex-col rounded-2xl p-4 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
            按答错次数排序 · {level}
          </p>
          <p className="mt-1 text-xs text-white/45">
            错得最多的排最前，没答过的排最后。想集中攻坚就照这份从头往下点。
          </p>
          <div data-word-scrollable="true" className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
            {ranking.map((row) => (
              <div
                key={row.id}
                className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${
                  row.forgotCount > 0 ? "border-[#81D8CF]/25 bg-[#81D8CF]/8" : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="jp truncate text-base font-semibold">{row.pattern}</p>
                  <p className="truncate text-xs text-white/55">{row.meaning}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm font-black ${row.forgotCount > 0 ? "text-[#81D8CF]" : "text-white/30"}`}>
                    错 {row.forgotCount}
                  </p>
                  <p className="text-[10px] text-white/40">
                    {row.knownForever ? "已熟知" : row.seenCount > 0 ? `答过 ${row.seenCount}` : "没答过"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : card ? (
        <GrammarCard
          card={card}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onAnswer={answer}
        />
      ) : (
        // 今天的都过关了。不自动往后借明天的账 —— 想继续得自己点，和单词的续杯同理。
        <div className="dictionary-card grid min-h-[320px] place-items-center rounded-2xl p-6 text-center">
          <div>
            <p className="text-2xl font-bold">{level} 今天过完了</p>
            <p className="mt-2 text-sm text-white/60">
              到期的 {total} 条都过关了，剩下的 FSRS 排在后面几天
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                onClick={encore}
                className="focus-ring zoo-pop inline-flex items-center gap-1 rounded-2xl bg-[#81D8CF] px-5 py-3 text-sm font-bold !text-[#2f3333]"
              >
                <Plus size={16} />
                再学 {GRAMMAR_ENCORE_SIZE} 条新的
              </button>
              <button
                onClick={() => setShowRanking(true)}
                className="focus-ring rounded-2xl border border-white/20 bg-[#81D8CF]/10 px-5 py-3 text-sm font-bold hover:bg-[#81D8CF]/15"
              >
                看错得最多的
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
