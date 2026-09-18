import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, RotateCcw, X } from "lucide-react";
import { buildQuestions, quizGroups, settleGroup, type DistinctionQuestion, type QuizScope } from "../lib/distinction-quiz";

interface DistinctionQuizPageProps {
  scope: QuizScope;
  onBackToConfusion: () => void;
}

interface DistinctionQuizSessionProps {
  scope: QuizScope;
  onBackToConfusion: () => void;
  onRetryGroup: (key: string) => void;
}

type Feedback = { selected: number; correct: boolean };

const scopeTitle = (scope: QuizScope): string => {
  if (scope.kind === "group") return "练这组";
  if (scope.kind === "type") return "分类练习";
  if (scope.kind === "today") return "今天碰到的易混组";
  return "已学易混组";
};

const optionClass = (optionId: number, question: DistinctionQuestion, feedback: Feedback | null): string => {
  const base = "focus-ring flex min-h-14 items-center rounded-2xl border px-4 text-left text-base font-bold transition-colors";
  if (!feedback) return `${base} border-white/15 bg-white/8 hover:bg-white/14`;
  if (optionId === question.answerId) return `${base} border-emerald-300/70 bg-emerald-400/25 text-emerald-50`;
  if (optionId === feedback.selected) return `${base} border-rose-300/70 bg-rose-400/25 text-rose-50`;
  return `${base} border-white/10 bg-white/5 text-white/45`;
};

export const DistinctionQuizPage = ({ scope: initialScope, onBackToConfusion }: DistinctionQuizPageProps) => {
  const [scope, setScope] = useState(initialScope);
  return (
    <DistinctionQuizSession
      key={JSON.stringify(scope)}
      scope={scope}
      onBackToConfusion={onBackToConfusion}
      onRetryGroup={(key) => setScope({ kind: "group", key })}
    />
  );
};

const DistinctionQuizSession = ({ scope, onBackToConfusion, onRetryGroup }: DistinctionQuizSessionProps) => {
  const questions = useMemo(() => buildQuestions(quizGroups(scope)), [scope]);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [groupCorrect, setGroupCorrect] = useState<Map<string, boolean>>(new Map());
  const [done, setDone] = useState(false);
  const settled = useRef(false);
  const question = questions[index] ?? null;

  useEffect(() => {
    if (!done || settled.current) return;
    settled.current = true;
    groupCorrect.forEach((allCorrect, key) => settleGroup(key, allCorrect));
  }, [done, groupCorrect]);

  const choose = (selected: number) => {
    if (!question || feedback) return;
    const correct = selected === question.answerId;
    setFeedback({ selected, correct });
    setGroupCorrect((current) => {
      const next = new Map(current);
      next.set(question.groupKey, (next.get(question.groupKey) ?? true) && correct);
      return next;
    });
  };

  const next = () => {
    if (!feedback) return;
    if (index + 1 >= questions.length) setDone(true);
    else {
      setIndex((value) => value + 1);
      setFeedback(null);
    }
  };

  if (!questions.length) {
    return (
      <section className="mx-auto w-full max-w-3xl">
        <div className="rounded-3xl border border-white/10 bg-[#3f4343] p-8 text-center">
          <p className="text-lg font-bold text-white">这个范围里还没有能练的组</p>
          <button type="button" onClick={onBackToConfusion} className="focus-ring mt-5 inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white/75">
            <ArrowLeft size={16} /> 回疑难辨析
          </button>
        </div>
      </section>
    );
  }

  if (done) {
    const keys = [...new Set(questions.map((item) => item.groupKey))];
    return (
      <section className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">DISTINCTION PRACTICE</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">辨析练习完成</h1>
        </div>
        <div className="space-y-3">
          {keys.map((key) => {
            const first = questions.find((item) => item.groupKey === key)!;
            const correct = groupCorrect.get(key) ?? false;
            return (
              <div key={key} className="rounded-2xl border border-white/10 bg-[#3f4343] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">{first.options.map((option) => `${option.surface}（${option.kana}）`).join(" / ")}</p>
                    <p className="mt-1 text-sm text-white/55">{correct ? "这一组全答对了" : "这一组有答错"}</p>
                  </div>
                  {correct ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/20 px-2.5 py-1 text-xs font-bold text-emerald-100"><Check size={13} /> 已掌握</span> : (
                    <button type="button" onClick={() => onRetryGroup(key)} className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-xs font-bold text-white/75"><RotateCcw size={13} /> 再练这组</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={onBackToConfusion} className="focus-ring mt-5 inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white/75">
          <ArrowLeft size={16} /> 回疑难辨析
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">DISTINCTION PRACTICE</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">{scopeTitle(scope)}</h1>
        </div>
        <span className="text-xs font-semibold text-white/50">{index + 1} / {questions.length}</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[#81D8CF] transition-[width]" style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
      </div>
      {question && (
        <>
          <div className="rounded-3xl border border-white/10 bg-[#3f4343] p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">中文线索</p>
            <p className="mt-3 text-2xl font-extrabold text-white">{question.prompt}</p>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {question.options.map((option, optionIndex) => (
              <button
                type="button"
                key={option.id}
                disabled={Boolean(feedback)}
                onClick={() => choose(option.id)}
                className={optionClass(option.id, question, feedback)}
                aria-pressed={feedback?.selected === option.id}
              >
                <span className="mr-3 text-xs text-white/35">{optionIndex + 1}</span>
                {option.surface}
                <span className="ml-2 text-xs text-white/45">{option.kana}</span>
              </button>
            ))}
          </div>
          {feedback && (
            <div className={`mt-4 rounded-2xl border p-4 ${feedback.correct ? "border-emerald-300/35 bg-emerald-400/10" : "border-rose-300/35 bg-rose-400/10"}`}>
              <p className="flex items-center gap-2 font-extrabold text-white">
                {feedback.correct ? <Check size={17} /> : <X size={17} />}
                {feedback.correct ? "答对了" : "答错了"}
              </p>
              <p className="mt-2 text-sm leading-6 text-white/80">{question.summary}</p>
              <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                {question.options.map((option) => {
                  const note = question.notes.get(String(option.id));
                  return note ? <p key={option.id} className="text-sm text-white/65"><b className="text-white/85">{option.surface}<span className="ml-1 font-normal text-white/45">{option.kana}</span></b>：{note}</p> : null;
                })}
              </div>
              <button type="button" onClick={next} className="focus-ring mt-4 w-full rounded-xl bg-white/12 px-3 py-2.5 text-sm font-bold text-white hover:bg-white/18">
                {index + 1 >= questions.length ? "查看结果" : "下一题"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
