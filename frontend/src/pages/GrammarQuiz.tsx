import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, ListOrdered, RotateCcw } from "lucide-react";
import type { JLPTLevel } from "../types/grammar";
import {
  getGrammarQuizSession,
  grammarQuizRanking,
  startGrammarQuizRound,
  submitGrammarQuizAnswer,
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
 * 和单词学习共用同一副骨架（同样的卡、同样 h-16 的「显示答案」占位、翻面后原地
 * 换成评分行），但**内核完全不同**：没有 FSRS、没有当日计划、没有排片。
 * 一个等级一百来条，一轮洗一次牌走完为止，理由见 lib/grammar-quiz.ts 顶上的注释。
 *
 * 评分只有三颗，没有「模糊」——「模糊」在单词那边的意义是喂给 FSRS 的 Hard 档，
 * 这里没有调度器接它，摆上去就是一个不知道会发生什么的按钮。
 */
const ANSWERS: { value: GrammarQuizAnswer; label: string; hint: string; secondary?: boolean }[] = [
  { value: "forgot", label: "没记住", hint: "V" },
  { value: "know", label: "记得", hint: "N" },
  { value: "known_forever", label: "熟知", hint: "M", secondary: true }
];

export const GrammarQuiz = ({ initialLevel, onBack }: GrammarQuizProps) => {
  // 考题一次只能考一个等级 —— 「一轮把这个等级过一遍」是这个模式的定义，
  // 五个等级混在一起就没有「一轮」可言了。所以等级选择器长在这里，
  // 而不是沿用列表页那个可以选「全部」的筛选。
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

  const restart = useCallback(() => {
    setSession(startGrammarQuizRound(level));
    setRevealed(false);
    setShowRanking(false);
  }, [level]);

  // 键盘：任意普通键翻面，翻面后 V/N/M 评分。和单词学习一致。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (!session?.card) return;
      if (!revealed) {
        if (event.key.length === 1 || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setRevealed(true);
        }
        return;
      }
      const hit = ANSWERS.find((option) => option.hint.toLowerCase() === event.key.toLowerCase());
      if (hit) {
        event.preventDefault();
        answer(hit.value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, revealed, session]);

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
            {level} 语法考题 · 第 {session?.seq ?? 1} 轮
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
          onClick={restart}
          title="重新洗牌，开新一轮"
          className="focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* 等级选择器。每个等级各自记一轮进度（roundKey 带等级），切回来接着上次那张。 */}
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

      {/* 本轮进度：一轮就是把这个等级过一遍，所以进度条在这里是有意义的 */}
      <div className="mb-2 lg:mx-auto lg:w-[min(900px,100%)]">
        <div className="flex items-center justify-between text-xs font-semibold text-white/55">
          <span>本轮 {done} / {total}</span>
          <span>{percent}%</span>
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
            这个模式里唯一的「算法」就是这一条：错得最多的排最前，没答过的排最后。
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
        <div key={card.id} className="zoo-enter dictionary-card flex h-full min-h-0 flex-col gap-2 rounded-2xl px-3 pb-2 pt-3 sm:gap-3 sm:p-6">
          {/* 题面：句型本身。点一下翻面，和单词学习一样。 */}
          <div
            onClick={() => !revealed && setRevealed(true)}
            className={`grid min-h-0 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#464949] px-3 py-4 text-center sm:min-h-32 sm:p-6 lg:mx-auto lg:w-[min(900px,100%)] ${
              revealed ? "" : "cursor-pointer"
            }`}
          >
            <div className="w-full min-w-0">
              <span className="rounded-sm border border-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white/60">
                {card.level}
              </span>
              <p className="jp-serif mt-2 break-words text-3xl font-semibold leading-tight sm:text-5xl lg:text-6xl">
                {card.pattern}
              </p>
            </div>
          </div>

          <div
            data-word-scrollable="true"
            className="grid min-h-0 flex-1 place-items-center overflow-y-auto rounded-2xl border border-white/15 bg-[#424545] p-4 text-center sm:p-6 lg:mx-auto lg:w-[min(900px,100%)]"
          >
            {revealed ? (
              <div className="zoo-reveal-in w-full min-w-0">
                {/* 答案上半：接续 */}
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">接续</p>
                <p className="jp mx-auto mt-2 max-w-2xl break-words text-xl font-semibold leading-8 sm:text-2xl">
                  {card.formation || "—"}
                </p>
                {/* 答案下半：中文意 */}
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-white/55">中文意</p>
                <p className="mx-auto mt-2 max-w-2xl break-words text-lg leading-7 text-white/85 sm:text-xl">
                  {card.meaning || "—"}
                </p>
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
                onClick={() => setRevealed(true)}
                className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]"
              >
                <Eye size={18} />
                <span>显示答案</span>
                <span className="text-xs font-semibold opacity-65">（按任意键）</span>
              </button>
            ) : (
              <div className="zoo-rate-row grid h-16 grid-cols-[1.35fr_1.35fr_0.65fr] gap-2 sm:gap-3">
                {ANSWERS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => answer(option.value)}
                    aria-keyshortcuts={option.hint}
                    className={`focus-ring zoo-pop h-16 min-w-0 rounded-2xl border ${
                      option.secondary
                        ? "border-white/12 px-1 text-sm font-semibold text-white/60 hover:bg-white/[0.06]"
                        : "border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15"
                    }`}
                  >
                    <span className="block text-[10px] font-black tracking-[0.18em] text-white/45">{option.hint}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        // 一轮走完。不自动续下一轮 —— 「过完一遍」本身是个终点，值得停一下。
        <div className="dictionary-card grid min-h-[320px] place-items-center rounded-2xl p-6 text-center">
          <div>
            <p className="text-2xl font-bold">第 {session?.seq ?? 1} 轮过完了</p>
            <p className="mt-2 text-sm text-white/60">{level} 的 {total} 条都过了一遍</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                onClick={restart}
                className="focus-ring zoo-pop rounded-2xl bg-[#81D8CF] px-5 py-3 text-sm font-bold !text-[#2f3333]"
              >
                重新洗牌，再来一轮
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
