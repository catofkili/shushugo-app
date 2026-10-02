import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { JLPT_KINDS, KIND_LABEL, type JlptAnswer, type JlptBank, type JlptQuestion } from "../../lib/jlpt-practice";
import { Explanation, QuestionStem } from "./Question";

export function PracticeResult({ bank, questions, answers, mock, onRestart, onBack }: {
  bank: JlptBank;
  questions: JlptQuestion[];
  answers: JlptAnswer[];
  mock: boolean;
  onRestart: () => void;
  onBack: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const chosen = new Map(answers.map(answer => [answer.questionId, answer.chosen]));
  const correct = questions.filter(q => chosen.get(q.id) === q.answer).length;
  const review = mock ? questions : questions.filter(q => chosen.get(q.id) !== q.answer);

  return <>
    <section className="ds-card jq-card">
      <h2 className="jq-heading">{mock ? "模拟卷结果" : "练习小结"}</h2>
      <p className="jq-score"><span className="jq-score-label">答对</span> {correct}<span className="jq-score-total"> / {questions.length} 题</span></p>
      {mock && <div className="jq-stack">
        {JLPT_KINDS.map(kind => {
          const group = questions.filter(q => q.kind === kind);
          if (!group.length) return null;
          const count = group.filter(q => chosen.get(q.id) === q.answer).length;
          const percent = Math.round(count / group.length * 100);
          return <div key={kind} className="jq-stat">
            <div className="jq-meta"><span>{KIND_LABEL[kind]}</span><span>{percent}%</span></div>
            <div className="jq-progress" role="progressbar" aria-label={`${KIND_LABEL[kind]}正确率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className="jq-progress-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>;
        })}
      </div>}
    </section>
    <div className="jq-actions">
      <button type="button" className="ds-btn jq-grow focus-ring" onClick={onRestart}><RotateCcw size={16} />{mock ? "再做一次" : "再来一组"}</button>
      <button type="button" className="ds-btn-soft jq-grow focus-ring" onClick={onBack}>回到列表</button>
    </div>
    {review.length > 0 && <section className="jq-stack">
      <h2 className="jq-heading">{mock ? "逐题回看" : `答错的题 ${review.length}`}</h2>
      {review.map(q => {
        const choice = chosen.get(q.id) ?? 0;
        const isCorrect = choice === q.answer;
        const open = expanded === q.id;
        return <div key={q.id} className="jq-stack">
          <div className="ds-card jq-review-card">
            <button type="button" className="jq-review-toggle focus-ring" aria-expanded={open} onClick={() => setExpanded(open ? null : q.id)}>
              {isCorrect ? <Check size={18} className="jq-correct jq-icon" /> : <X size={18} className="jq-wrong jq-icon" />}
              <span className="jq-grow">第 {questions.indexOf(q) + 1} 题 · {KIND_LABEL[q.kind]}</span>
              <span className="jq-muted">{open ? "收起" : "查看"}</span>
            </button>
            {open && <div className="jq-review-body">
              <QuestionStem bank={bank} question={q} />
              <div className="jq-answer-block">
                <p className="jq-answer-line">你的选择：{choice ? `${choice}．${q.options[choice - 1]}` : "未答"}</p>
                <p className="jq-answer-line jq-correct">正解：{q.answer}．{q.options[q.answer - 1]}</p>
              </div>
            </div>}
          </div>
          {open && <Explanation question={q} chosen={choice} />}
        </div>;
      })}
    </section>}
  </>;
}
