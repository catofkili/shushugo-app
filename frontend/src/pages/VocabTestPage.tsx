import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, Pause, Play, RotateCcw, X } from "lucide-react";
import {
  finishVocabTest,
  getVocabTestResult,
  getVocabTestSession,
  startVocabTest,
  submitVocabTestAnswer,
  secondsForQuestion,
  type VocabTestAnswerState,
  type VocabTestQuestion,
  type VocabTestResult,
  type VocabTestSession
} from "../lib/vocab-test";

type View = "intro" | "quiz" | "result";

const answerLabel = (state: VocabTestAnswerState): string => {
  if (state === "correct") return "答对了";
  if (state === "unknown") return "记为不认识";
  if (state === "timeout") return "超时，记为不认识";
  return "这题选错了";
};

const answerClass = (state: VocabTestAnswerState): string => {
  if (state === "correct") return "vocab-fb-correct";
  if (state === "unknown" || state === "timeout") return "vocab-fb-unknown";
  return "vocab-fb-wrong";
};

const QuestionCard = ({
  question,
  disabled,
  onChoose,
  feedback
}: {
  question: VocabTestQuestion;
  disabled: boolean;
  onChoose: (index: number | null) => void;
  feedback: { state: VocabTestAnswerState; selected: number | null } | null;
}) => (
  <div className="dictionary-card rounded-3xl p-4 shadow-xl sm:p-6">
    <div className="mb-5 flex items-center justify-between gap-3 text-xs font-bold text-white/55">
      <span>{question.kind === "reading" ? "读音题" : "释义题"}</span>
      <span>{question.level}</span>
    </div>
    <div className="grid min-h-[130px] place-items-center vocab-prompt-panel rounded-2xl px-4 py-8 text-center">
      <p className="font-serif text-4xl font-extrabold tracking-wide sm:text-5xl">
        {question.prompt}
      </p>
      <p className="mt-3 text-xs font-semibold text-white/45">
        {question.kind === "reading" ? "请选择假名读音" : "请选择中文释义"}
      </p>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {question.options.map((option, index) => {
        const isCorrect = feedback && index === question.answerIndex;
        const isSelected = feedback && index === feedback.selected;
        return (
          <button
            key={`${question.id}-${index}`}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(index)}
            className={`focus-ring min-h-12 rounded-2xl border px-3 py-3 text-left text-sm font-bold transition ${
              isCorrect ? "border-[#81D8CF] bg-[#81D8CF]/18 text-[#81D8CF]"
                : isSelected ? "border-red-300/60 bg-red-300/10 text-red-200"
                  : "border-white/15 bg-white/[0.04] text-white/78 hover:bg-white/[0.08] disabled:cursor-default"
            }`}
          >
            <span className="mr-2 text-xs text-white/38">{index + 1}</span>
            {option}
            {isCorrect && <Check size={15} className="float-right mt-0.5" />}
            {isSelected && !isCorrect && <X size={15} className="float-right mt-0.5" />}
          </button>
        );
      })}
    </div>
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChoose(null)}
      className={`focus-ring mt-2 min-h-11 w-full rounded-2xl border px-3 py-2.5 text-sm font-bold transition ${
        feedback?.state === "unknown" || feedback?.state === "timeout"
          ? "vocab-fb-unknown"
          : "border-white/12 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] disabled:cursor-default"
      }`}
    >
      不认识
    </button>
  </div>
);

/**
 * ⚠️ 少于这个题数不摆数字。
 *
 * 估计量本身没问题：一个等级一题没答，方差就按该等级词数的平方算，区间自然撑满。
 * 但那意味着答 2 题会得到「0 – 8,482」—— 数学上诚实，摆出来却是在胡说。
 * 门槛取 15：五个等级各摊三题，每个等级至少有话可说。
 */
const MIN_ANSWERS_FOR_ESTIMATE = 15;

const ResultView = ({ result, onRestart, onBack }: { result: VocabTestResult; onRestart: () => void; onBack: () => void }) => (
  <div className="mx-auto w-full max-w-3xl dictionary-card rounded-3xl p-5 shadow-xl sm:p-7">
    <div className="text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/48">VOCABULARY SIZE</p>
      <h2 className="mt-2 text-2xl font-extrabold">
        {result.answered >= MIN_ANSWERS_FOR_ESTIMATE ? "你的词汇量" : "答得还太少"}
      </h2>
      {result.answered >= MIN_ANSWERS_FOR_ESTIMATE ? (
        <>
          {/* 摆点估计，不摆区间。区间退到底下那行小字 ——
              「3,860 – 6,402」这种宽度读不出任何东西，用户宁可要一个具体数字。 */}
          <p className="mt-4 text-4xl font-extrabold text-[#81D8CF] sm:text-5xl">
            约 {result.estimated.toLocaleString()} 词
          </p>
          <p className="mt-2 text-sm font-semibold text-white/58">
            在当前 JLPT 词表覆盖范围内 · 区间 {result.lower.toLocaleString()}–{result.upper.toLocaleString()}
          </p>
        </>
      ) : (
        <p className="mx-auto mt-4 max-w-md text-sm font-semibold leading-relaxed text-white/58">
          只答了 {result.answered} 题，还有等级一题没碰过，给不出有意义的区间。
          至少答满 {MIN_ANSWERS_FOR_ESTIMATE} 题（五个等级各三题左右）再看结果。
        </p>
      )}
    </div>
    <div className="mt-6 grid gap-2 sm:grid-cols-3">
      <div className="rounded-2xl bg-white/5 p-3 text-center">
        <b className="block text-xl">{result.answered}</b>
        <span className="text-xs text-white/52">已答题</span>
      </div>
      <div className="rounded-2xl bg-white/5 p-3 text-center">
        <b className="block text-xl">{result.confidence}%</b>
        <span className="text-xs text-white/52">结果可信度</span>
      </div>
      <div className="rounded-2xl bg-white/5 p-3 text-center">
        <b className="block text-xl">{result.answered >= MIN_ANSWERS_FOR_ESTIMATE ? result.recommendation : "—"}</b>
        <span className="text-xs text-white/52">建议从这里继续</span>
      </div>
    </div>
    <div className="mt-6">
      <h3 className="text-sm font-extrabold text-white/78">各级表现</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-5">
        {result.levels.map((level) => (
          <div key={level.level} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center">
            <b className="block">{level.level}</b>
            <span className="mt-1 block text-xs text-white/52">
              {level.rate == null ? "未答" : `${Math.round(level.rate * 100)}%`}
            </span>
            <span className="mt-1 block text-[11px] text-white/38">{level.answered} 题</span>
          </div>
        ))}
      </div>
    </div>
    <p className="mt-5 rounded-2xl border border-white/12 bg-white/5 p-3 text-xs leading-relaxed text-white/58">
      这是 JLPT 覆盖词表内的估计，不等于“全日语词汇量”。测验结果不会改变学习进度、复习流水或 FSRS。
    </p>
    <div className="mt-6 flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onBack} className="focus-ring rounded-2xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/70 hover:bg-white/[0.08]">返回</button>
      <button type="button" onClick={onRestart} className="focus-ring inline-flex items-center gap-2 rounded-2xl bg-[#81D8CF] px-4 py-2.5 text-sm font-extrabold text-[#293333] hover:bg-[#A4E7E0]"><RotateCcw size={15} />重新测一次</button>
    </div>
  </div>
);

export function VocabTestPage() {
  const [session, setSession] = useState<VocabTestSession | null>(() => getVocabTestSession());
  const [view, setView] = useState<View>(() => {
    const current = getVocabTestSession();
    if (current?.finishedAt) return "result";
    if (current && current.responses.length > 0) return "quiz";
    return "intro";
  });
  const [feedback, setFeedback] = useState<{ question: VocabTestQuestion; state: VocabTestAnswerState; selected: number | null } | null>(null);
  const [remaining, setRemaining] = useState(15);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const questionStartedAt = useRef(0);

  const question = useMemo(() => {
    if (!session || session.currentIndex >= session.questions.length) return null;
    return session.questions[session.currentIndex];
  }, [session]);

  /**
   * ⚠️ 展示用的题必须是**刚答完那一道**，不是当前指针指的那道。
   *
   * `submitVocabTestAnswer` 一提交就把 currentIndex 推到下一题，所以答完的瞬间
   * `question` 已经换人了。照 `question` 渲染的话：新题的题面冒出来、
   * 新题的正确项被 feedback 标成绿色（「还没点就出答案」）、
   * 底下那行还写着上一题的答案。三个现象是同一个 bug。
   */
  const shownQuestion = feedback ? feedback.question : question;

  const choose = useCallback((selected: number | null) => {
    if (!question || feedback || paused) return;
    const state: VocabTestAnswerState = selected == null
      ? "unknown"
      : selected === question.answerIndex ? "correct" : "wrong";
    const next = submitVocabTestAnswer(state, selected, Date.now() - questionStartedAt.current);
    if (!next) return;
    setSession(next);
    setFeedback({ question, state, selected });
  }, [feedback, paused, question]);

  useEffect(() => {
    if (view !== "quiz" || !question) return;
    questionStartedAt.current = Date.now();
    setRemaining(secondsForQuestion(question));
  }, [view, question]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (view !== "quiz" || !question || feedback || paused) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          const currentQuestion = question;
          const next = submitVocabTestAnswer("timeout", null, Date.now() - questionStartedAt.current);
          if (next) {
            setSession(next);
            setFeedback({ question: currentQuestion, state: "timeout", selected: null });
          }
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [feedback, paused, question, view]);

  useEffect(() => {
    if (view !== "quiz" || feedback || !question) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || paused) return;
      if (event.key.toLowerCase() === "u") {
        event.preventDefault();
        choose(null);
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < question.options.length) {
        event.preventDefault();
        choose(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, feedback, paused, question, view]);

  const begin = (restart: boolean) => {
    setError("");
    try {
      const next = startVocabTest();
      setSession(next);
      setFeedback(null);
      setPaused(false);
      setView("quiz");
    } catch {
      // 词库太小的情况在正式 App 中不应发生；保留当前页面，不伪造结果。
      setError("当前词库可用于测验的词太少，暂时无法开始。");
      if (restart) setView("intro");
    }
  };

  const atEnd = Boolean(session && (session.finishedAt || session.currentIndex >= session.questions.length));

  const nextQuestion = () => {
    if (!session) return;
    setFeedback(null);
    if (atEnd) {
      setView("result");
      return;
    }
    // 计时和响应时长都要在**关掉反馈那一刻**重置：question 早在提交时就换了，
    // 那个 effect 不会再触发，不重置的话下一题的用时里含着读反馈的时间。
    questionStartedAt.current = Date.now();
    if (question) setRemaining(secondsForQuestion(question));
  };

  const stop = () => {
    const next = finishVocabTest();
    if (!next) return;
    setSession(next);
    setFeedback(null);
    setView("result");
  };

  const result = getVocabTestResult(session);

  if (view === "result" && result) {
    return <ResultView result={result} onRestart={() => begin(true)} onBack={() => setView("intro")} />;
  }

  if (view === "intro" || !session || !shownQuestion) {
    const resumable = session && !session.finishedAt && session.responses.length > 0;
    return (
      <div className="mx-auto w-full max-w-3xl dictionary-card rounded-3xl p-5 shadow-xl sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/48">VOCABULARY CHECK</p>
        <h2 className="mt-2 text-2xl font-extrabold">查一下词汇量</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/65">
          用一组跨 N5–N1 的抽样题，估计你在当前 JLPT 词表覆盖范围内认识多少词。每题只有一个正确答案，
          不认识可以直接说“不认识”，不要把这次测量变成学习进度。
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/[0.05] p-3"><b className="block">约 60 题</b><span className="text-xs text-white/50">可随时结束</span></div>
          <div className="rounded-2xl bg-white/[0.05] p-3"><b className="block">读音 15 秒 · 释义 10 秒</b><span className="text-xs text-white/50">切走会暂停</span></div>
          <div className="rounded-2xl bg-white/[0.05] p-3"><b className="block">独立记录</b><span className="text-xs text-white/50">不改学习状态</span></div>
        </div>
        {resumable && <p className="mt-4 rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/[0.07] p-3 text-sm font-semibold text-[#BFF4EE]">上次测验答到 {session.responses.length} / {session.questions.length}，可以继续。</p>}
        {error && <p role="alert" className="mt-4 rounded-2xl border border-red-300/25 bg-red-300/[0.07] p-3 text-sm font-semibold text-red-100">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {resumable && <button type="button" onClick={() => { setView("quiz"); setFeedback(null); }} className="focus-ring inline-flex items-center gap-2 rounded-2xl bg-[#81D8CF] px-4 py-2.5 text-sm font-extrabold text-[#293333]"><Play size={15} />继续测验</button>}
          <button type="button" onClick={() => begin(Boolean(resumable))} className="focus-ring inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white/80 hover:bg-white/[0.1]"><RotateCcw size={15} />{resumable ? "重新开始" : "开始测验"}</button>
        </div>
      </div>
    );
  }

  const progress = Math.round((session.responses.length / session.questions.length) * 100);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/48">VOCABULARY CHECK</p>
          <h2 className="mt-1 text-xl font-extrabold">词汇量测验</h2>
        </div>
        <button type="button" onClick={stop} className="focus-ring rounded-2xl border border-white/15 px-3 py-2 text-xs font-bold text-white/60 hover:bg-white/[0.08]">结束并看结果</button>
      </div>
      <div className="mb-3 flex items-center gap-3 text-xs font-semibold text-white/55">
        <span className="min-w-0 flex-1">已答 {session.responses.length} / {session.questions.length}</span>
        <span className="inline-flex items-center gap-1"><Clock3 size={14} />{paused ? "已暂停" : `${remaining}s`}</span>
        {paused ? <Pause size={15} className="text-white/70" /> : <Play size={15} className="text-[#BFF4EE]" />}
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#81D8CF] transition-[width]" style={{ width: `${progress}%` }} /></div>
      <QuestionCard question={shownQuestion} disabled={Boolean(feedback) || paused} onChoose={choose} feedback={feedback ? { state: feedback.state, selected: feedback.selected } : null} />
      {paused && <p className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl vocab-fb-unknown border px-3 py-2 text-xs font-semibold"><Pause size={14} />切回此页面后会继续计时</p>}
      {feedback && (
        <div className={`mt-3 rounded-2xl border p-3 ${answerClass(feedback.state)}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-extrabold">{answerLabel(feedback.state)}</p>
            <span className="text-xs font-bold opacity-75">答案：{feedback.question.answer}</span>
          </div>
          <button type="button" onClick={nextQuestion} className="focus-ring mt-3 w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/[0.08]">
            {atEnd ? "查看结果" : "下一题"}
          </button>
        </div>
      )}
    </div>
  );
}
