import { Check, X } from "lucide-react";
import { MascotSay } from "../../components/MascotSay";
import { ScrollArea } from "../../components/ScrollArea";
import { KIND_LABEL, parseStem, type JlptBank, type JlptQuestion, type OptionNo } from "../../lib/jlpt-practice";

export function Stem({ text, activeRef }: { text: string; activeRef?: number }) {
  return <>{parseStem(text).map((part, index) => {
    switch (part.type) {
      case "text": return <span className="jq-text" key={index}>{part.text}</span>;
      case "underline": return <span className="jq-underline" key={index}>{part.text}</span>;
      case "blank": return <span className="jq-blank" key={index} aria-label="空欄" />;
      case "slot": return <span className="jq-slot" key={index} aria-label={part.star ? "★の位置" : "空欄"}>
        <span className="jq-star">{part.star ? "★" : "\u00a0"}</span><span className="jq-slot-line" />
      </span>;
      case "ref": return <span className={`jq-ref ${part.n === activeRef ? "jq-ref-active" : ""}`} key={index}>{part.n}</span>;
    }
  })}</>;
}

export function QuestionStem({ bank, question }: { bank: JlptBank; question: JlptQuestion }) {
  const passage = question.passageId ? bank.passages[question.passageId] : undefined;
  const activeRef = parseStem(question.stem).find(part => part.type === "ref");
  return <>
    {passage && <ScrollArea key={question.id} className="jq-passage" role="region" aria-label="文章">
      <div className="jq-passage-content"><Stem text={passage} activeRef={activeRef?.type === "ref" ? activeRef.n : undefined} /></div>
    </ScrollArea>}
    <p className="jq-stem"><Stem text={question.stem} /></p>
  </>;
}

export function Question({ bank, question, chosen, reveal = false, showKind = true, disabled = false, onChoose }: {
  bank: JlptBank;
  question: JlptQuestion;
  chosen: 0 | OptionNo;
  reveal?: boolean;
  showKind?: boolean;
  disabled?: boolean;
  onChoose: (chosen: OptionNo) => void;
}) {
  const singleColumn = question.kind === "usage" || question.options.some(option => [...option].length > 12);
  return <div className="ds-card jq-card">
    {showKind && <span className="jq-kind">{KIND_LABEL[question.kind]}</span>}
    <QuestionStem bank={bank} question={question} />
    <div className={`ds-choices ${singleColumn ? "jq-choices-long" : ""}`}>
      {question.options.map((option, index) => {
        const no = (index + 1) as OptionNo;
        const correct = reveal && no === question.answer;
        const wrong = reveal && chosen === no && !correct;
        return <button type="button" key={no} disabled={reveal || disabled} aria-pressed={chosen === no}
          className={`ds-choice jq-choice focus-ring ${correct ? "is-correct" : wrong ? "is-wrong" : chosen === no ? "jq-choice-selected" : ""}`}
          onClick={() => onChoose(no)}>
          <span className="ds-choice-key">{no}</span><span className="jq-option">{option}</span>
          {correct && <Check size={16} className="jq-icon" />}
          {wrong && <X size={16} className="jq-icon" />}
        </button>;
      })}
    </div>
  </div>;
}

export function Explanation({ question, chosen }: { question: JlptQuestion; chosen: 0 | OptionNo }) {
  const correct = chosen === question.answer;
  const distractor = chosen ? question.distractors[String(chosen) as `${OptionNo}`] : undefined;
  return <MascotSay sticker={correct ? "mood-yay" : "mood-puzzled"} tone={correct ? "good" : "warn"} className="ds-say-onbg">
    <p className="jq-feedback-title">{correct ? "答对了" : chosen ? "这题选错了" : "这题没答"}</p>
    <p className="jq-explanation">{question.explanation}</p>
    {!correct && distractor && <p className="jq-explanation">你选的第 {chosen} 项：{distractor}</p>}
    {question.order && <p className="jq-explanation">正确顺序：{question.order.map(no => question.options[no - 1]).join(" → ")}</p>}
  </MascotSay>;
}
