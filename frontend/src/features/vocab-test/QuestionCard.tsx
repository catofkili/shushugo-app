import { AnswerFeedbackBar } from "../../components/AnswerFeedbackBar";
import { Check, X } from "lucide-react";
import type { VocabTestAnswerState, VocabTestQuestion } from "../../lib/vocab-test";

export const QuestionCard = ({
  question,
  disabled,
  onChoose,
  feedback,
  next,
  combo = 0,
  questionNumber = 0
}: {
  question: VocabTestQuestion;
  disabled: boolean;
  onChoose: (index: number | null) => void;
  feedback: { state: VocabTestAnswerState; selected: number | null } | null;
  combo?: number;
  questionNumber?: number;
  /** 继续固定在屏幕底部，避免长反馈把按钮推到底栏下面；调用方仍负责原有推进/出分流程。 */
  next: { label: string; onClick: () => void };
}) => (
  <div key={question.id} className="ds-card vt-card ds-q-in">
    <div className="flex items-center gap-1.5">
      <span className="ds-pill">{question.kind === "reading" ? "读音题" : "释义题"}</span>
      <span className="ds-pill">{question.level}</span>
    </div>
    <p className="vt-prompt">{question.prompt}</p>
    <p className="vt-ask">
      {/* 拆掉送假名的题必须说清楚在问哪几个字，否则「培う 选 つちか」看着像少打了一个字 */}
      {question.kind !== "reading"
        ? "选出它的中文意思"
        : question.readingScope
          ? `选出「${question.readingScope}」的读音（送假名已给出）`
          : "选出它的读音"}
    </p>
    <div className="ds-choices">
      {question.options.map((option, index) => {
        const isCorrect = feedback && index === question.answerIndex;
        const isSelected = feedback && index === feedback.selected;
        return (
          <button
            key={`${question.id}-${index}`}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(index)}
            className={`ds-choice answer-choice focus-ring ${isCorrect ? "is-correct" : isSelected ? "is-wrong" : ""}`}
          >
            <span className="ds-choice-key">{index + 1}</span>
            <span className="min-w-0 flex-1">{option}</span>
            {isCorrect && <Check size={16} className="shrink-0" />}
            {isSelected && !isCorrect && <X size={16} className="shrink-0" />}
          </button>
        );
      })}
    </div>
    {feedback ? (
      <AnswerFeedbackBar key={questionNumber} correct={feedback.state === "correct"} answer={question.answer} combo={combo} questionNumber={questionNumber} onContinue={next.onClick} />
    ) : (
      <button type="button" disabled={disabled} onClick={() => onChoose(null)} className="vt-unknown focus-ring">不认识</button>
    )}
  </div>
);

