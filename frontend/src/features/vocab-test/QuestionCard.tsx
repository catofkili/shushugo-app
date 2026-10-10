import { Check, X } from "lucide-react";
import type { VocabTestAnswerState, VocabTestQuestion } from "../../lib/vocab-test";

export const QuestionCard = ({
  question,
  disabled,
  onChoose,
  feedback,
  next
}: {
  question: VocabTestQuestion;
  disabled: boolean;
  onChoose: (index: number | null) => void;
  feedback: { state: VocabTestAnswerState; selected: number | null } | null;
  /** 答完之后「不认识」那一格换成「下一题」：拇指不用挪，手机上也不会被推到底栏下面 */
  next: { label: string; onClick: () => void };
}) => (
  <div className="ds-card vt-card">
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
            className={`ds-choice focus-ring ${isCorrect ? "is-correct" : isSelected ? "is-wrong" : ""}`}
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
      <button type="button" onClick={next.onClick} className="ds-btn focus-ring mt-2.5 w-full">{next.label} →</button>
    ) : (
      <button type="button" disabled={disabled} onClick={() => onChoose(null)} className="vt-unknown focus-ring">不认识</button>
    )}
  </div>
);

