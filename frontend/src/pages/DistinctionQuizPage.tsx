import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, RotateCcw } from "lucide-react";
import { AnswerFeedbackBar } from "../components/AnswerFeedbackBar";
import { ComboBadge } from "../components/ComboBadge";
import { Sticker } from "../components/CapybaraMascot";
import { buildQuestions, quizGroups, settleGroup, type DistinctionQuestion, type QuizScope } from "../lib/distinction-quiz";
import { StreakSpark } from "../components/streak/StreakMoments";

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
  const base = "ds-choice answer-choice focus-ring flex min-h-14 items-center rounded-2xl border px-4 text-left text-base font-bold transition-colors";
  if (!feedback) return `${base} border-white/15 bg-white/8 hover:bg-white/14`;
  if (optionId === question.answerId) return `${base} is-correct`;
  if (optionId === feedback.selected) return `${base} is-wrong`;
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
  const [combo, setCombo] = useState(0);
  const locked = useRef(false);
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
    if (!question || feedback || locked.current) return;
    locked.current = true;
    const correct = selected === question.answerId;
    setFeedback({ selected, correct });
    setCombo(value => correct ? value + 1 : 0);
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
      locked.current = false;
    }
  };

  if (!questions.length) {
    return (
      <section className="mx-auto w-full max-w-3xl">
        <div className="rounded-3xl border border-white/10 bg-[#3f4343] p-8 text-center">
          <Sticker name="empty-box" size={96} className="mx-auto mb-3" />
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
      <StreakSpark />
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="mt-1 text-2xl font-extrabold text-white">{scopeTitle(scope)}</h1>
        </div>
        <span className="text-xs font-semibold text-white/50">{index + 1} / {questions.length}</span>
      </div>
      <div className="ds-progress-row"><div className="ds-progress" role="progressbar" aria-label="答题进度" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index + 1}>
        <div className="ds-progress-fill" style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
      </div><ComboBadge combo={combo} /></div>
      {question && (
        <div key={index} className="ds-q-in">
          <div className="rounded-3xl border border-white/10 bg-[#3f4343] p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">中文线索</p>
            <p className="mt-3 text-2xl font-extrabold text-white">{question.prompt}</p>
          </div>
          {feedback && (
            <div className="mt-4 rounded-2xl bg-[var(--ds-inset)] p-4">
              <p className="mt-2 text-sm leading-6 text-white/80">{question.summary}</p>
              <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                <p className="text-xs font-bold text-white/50">各词辨析与例句</p>
                {question.options.map((option) => {
                  const note = question.notes.get(String(option.id));
                  if (!note && !option.exampleJp && !option.exampleMeaning && !option.pairRole) return null;
                  return (
                    <div key={option.id} className="rounded-xl bg-black/10 px-3 py-2.5">
                      <p className="text-sm text-white/70"><b className="text-white/90">{option.surface}<span className="ml-1 font-normal text-white/45">{option.kana}</span></b>{option.pairRole && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold text-white/75">{option.pairRole}</span>}{note ? `：${note}` : ""}</p>
                      {option.exampleJp && <p className="mt-1.5 text-sm font-semibold leading-6 text-white/90"><span className="mr-1 text-xs font-normal text-white/45">例句</span>{option.exampleJp}</p>}
                      {option.exampleMeaning && <p className="mt-0.5 text-sm leading-5 text-white/70"><span className="mr-1 text-xs text-white/45">译文</span>{option.exampleMeaning}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
        </div>
      )}
      {question && feedback && <AnswerFeedbackBar key={index} correct={feedback.correct} answer={question.options.find(option => option.id === question.answerId)?.surface ?? ""} combo={combo} questionNumber={index} onContinue={next} />}
    </section>
  );
};
