import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, ListOrdered, Plus, Undo2 } from "lucide-react";
import { JapaneseRuby } from "../components/JapaneseRuby";
import type { JLPTLevel } from "../types/grammar";
import { answerHotkeyLabels, answerOptions } from "../features/word-study/word-study-utils";
import { patternPieces } from "../lib/grammar-formation";
import {
  extendGrammarQuizPlan,
  getGrammarQuizSession,
  grammarQuizRanking,
  submitGrammarQuizAnswer,
  undoLastGrammarQuizAnswer,
  GRAMMAR_ENCORE_SIZE,
  type GrammarQuizAnswer,
  type GrammarQuizCard,
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
 * 没毕业就当天隔几张重刷、每日新条目配额。所以评分是四颗不是三颗 ——
 * 「模糊」以前不摆是因为没有调度器接 Hard 档，现在有了。
 *
 * 题面上还多一件单词卡没有的事：翻面后把接续标在每个 `～` 的头上。
 * `～` 是这张卡真正的坑，标在坑边上比写在下面省掉「对号入座」那一步。
 * 标不准的（判据见 lib/grammar-formation.ts）就不标，只留下面那行完整接续。
 */
const PatternLine = ({ card, revealed }: { card: GrammarQuizCard; revealed: boolean }) => {
  const annotated = revealed && Boolean(card.attachment);
  if (!annotated) return <>{card.pattern}</>;
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

  // 键盘：任意普通键翻面，翻面后 V/B/N/M 评分。和单词学习一致。
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
      const hit = answerOptions.find(
        (option) => answerHotkeyLabels[option.value].toLowerCase() === event.key.toLowerCase()
      );
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
              {card.isNew && (
                <span className="ml-1.5 rounded-sm border border-[#81D8CF]/45 px-1.5 py-0.5 text-[11px] font-bold text-[#81D8CF]">
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
                onClick={() => setRevealed(true)}
                className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]"
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
                    onClick={() => answer(option.value)}
                    aria-keyshortcuts={answerHotkeyLabels[option.value]}
                    className={`focus-ring zoo-pop h-16 min-w-0 rounded-2xl border ${
                      option.secondary
                        ? "border-white/12 px-1 text-sm font-semibold text-white/60 hover:bg-white/[0.06]"
                        : "border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15"
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
