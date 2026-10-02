import { useCallback, useEffect, useRef, useState } from "react";
import { Timer, X } from "lucide-react";
import { MascotSay } from "../../components/MascotSay";
import {
  KIND_LABEL, SECTION_LABEL, recordJlptAnswers,
  type JlptAnswer, type JlptBank, type JlptMockPart, type JlptQuestion, type OptionNo
} from "../../lib/jlpt-practice";
import { scrollPageToTop } from "../../lib/touch-adapter";
import { Explanation, Question } from "./Question";

export function DrillSession({ bank, questions, mode, sessionId, onDone, onBack }: {
  bank: JlptBank;
  questions: JlptQuestion[];
  mode: "drill" | "mistakes";
  sessionId: string;
  onDone: (answers: JlptAnswer[]) => void;
  onBack: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<0 | OptionNo>(0);
  const [error, setError] = useState(false);
  const answers = useRef<JlptAnswer[]>([]);
  const locked = useRef(false);
  const question = questions[index];
  useEffect(() => { scrollPageToTop(); }, [index]);

  const save = (choice: OptionNo) => {
    try {
      const answer = { questionId: question.id, chosen: choice };
      recordJlptAnswers(bank, mode, sessionId, [answer]);
      answers.current.push(answer);
      setError(false);
    } catch {
      setError(true);
    }
  };
  const choose = (choice: OptionNo) => {
    // 同一帧的连点也只能记一次；React 的 state 更新尚未落下时，ref 已锁住。
    if (locked.current) return;
    locked.current = true;
    setChosen(choice);
    save(choice);
  };
  const next = () => {
    if (!chosen || error) return;
    if (index === questions.length - 1) onDone(answers.current);
    else {
      locked.current = false;
      setChosen(0);
      setIndex(index + 1);
    }
  };

  return <>
    <div className="jq-top">
      <span className="jq-count">{index + 1} / {questions.length}</span>
      <span className="jq-top-label">{mode === "mistakes" ? "错题本" : KIND_LABEL[question.kind]}</span>
      <button type="button" className="ds-btn-soft jq-small-button focus-ring" onClick={onBack}>回到列表</button>
    </div>
    <div className="jq-progress" role="progressbar" aria-label="答题进度" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index + 1}>
      <div className="jq-progress-fill" style={{ width: `${(index + 1) / questions.length * 100}%` }} />
    </div>
    <Question key={question.id} bank={bank} question={question} chosen={chosen} reveal={chosen !== 0} showKind={mode === "mistakes"} onChoose={choose} />
    {/* 按钮紧跟在选项下面：解析放在后面，答完不用滚屏就能点下一题 */}
    {chosen !== 0 && <button type="button" className="ds-btn jq-wide focus-ring" onClick={error ? () => save(chosen) : next}>
      {error ? "重试保存" : index === questions.length - 1 ? "看小结" : "下一题"}
    </button>}
    {error ? <MascotSay sticker="mood-puzzled" tone="warn" className="ds-say-onbg">作答没存好。再试一次。</MascotSay>
      : chosen !== 0 && <Explanation question={question} chosen={chosen} />}
  </>;
}

export function MockSession({ bank, parts, sessionId, onDone, onBack }: {
  bank: JlptBank;
  parts: JlptMockPart[];
  sessionId: string;
  onDone: (answers: JlptAnswer[]) => void;
  onBack: () => void;
}) {
  const [partIndex, setPartIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [deadline, setDeadline] = useState(() => Date.now() + parts[0].minutes * 60000);
  const [seconds, setSeconds] = useState(parts[0].minutes * 60);
  const [choices, setChoices] = useState<Record<string, OptionNo>>({});
  const choicesRef = useRef<Record<string, OptionNo>>({});
  const submittedPart = useRef(-1);
  const [confirm, setConfirm] = useState<"submit" | "exit" | null>(null);
  const [error, setError] = useState(false);
  const part = parts[partIndex];
  const question = part.questions[index];
  const answered = part.questions.filter(item => choices[item.id]).length;
  useEffect(() => { scrollPageToTop(); }, [index, partIndex]);

  const submitPart = useCallback(() => {
    if (submittedPart.current === partIndex) return;
    submittedPart.current = partIndex;
    setConfirm(null);
    if (partIndex < parts.length - 1) {
      const next = parts[partIndex + 1];
      setPartIndex(partIndex + 1);
      setIndex(0);
      setDeadline(Date.now() + next.minutes * 60000);
      setSeconds(next.minutes * 60);
      return;
    }
    const answers = parts.flatMap(item => item.questions.map(q => ({ questionId: q.id, chosen: choicesRef.current[q.id] ?? 0 } as JlptAnswer)));
    try {
      // 前一部分仅留在本次会话；只有整卷交完才写库。卸载 / 中途退出都不写。
      recordJlptAnswers(bank, "mock", sessionId, answers);
      onDone(answers);
    } catch {
      setError(true);
    }
  }, [bank, onDone, partIndex, parts, sessionId]);

  useEffect(() => {
    if (error) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) submitPart();
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deadline, error, submitPart]);

  const choose = (chosen: OptionNo) => {
    if (error || submittedPart.current === partIndex) return;
    // 从后台回来后，时钟回调可能还没执行；过了截止时间就不能再改答案。
    if (Date.now() >= deadline) { submitPart(); return; }
    choicesRef.current = { ...choicesRef.current, [question.id]: chosen };
    setChoices(choicesRef.current);
  };
  const retry = () => {
    submittedPart.current = -1;
    submitPart();
  };
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return <>
    <div className="jq-top">
      <span className="jq-top-label">{SECTION_LABEL[part.section]}</span>
      <span className={`jq-timer ${seconds <= 60 ? "jq-timer-warn" : ""}`}><Timer size={16} />{time}</span>
      <button type="button" className="ds-btn-soft jq-small-button focus-ring" onClick={() => setConfirm("exit")} disabled={error}><X size={14} />退出</button>
    </div>
    {/* 退出确认紧挨着顶上的「退出」：放在页面底下的话，点了退出屏幕上什么都不变 */}
    {confirm === "exit" && <>
      <MascotSay sticker="mood-ask" tone="warn" className="ds-say-onbg">退出后，这份卷不会留下记录。</MascotSay>
      <div className="jq-actions">
        <button type="button" className="ds-btn-soft jq-grow focus-ring" onClick={() => setConfirm(null)}>继续答题</button>
        <button type="button" className="ds-btn jq-grow focus-ring" onClick={onBack}>退出</button>
      </div>
    </>}
    <div className="jq-meta"><span>第 {index + 1} 题</span><span>已答 {answered} / 共 {part.questions.length}</span></div>
    <Question key={question.id} bank={bank} question={question} chosen={choices[question.id] ?? 0} disabled={error} onChoose={choose} />
    <div className="ds-card jq-card jq-stack">
      <div className="jq-actions">
        <button type="button" className="ds-btn-soft jq-grow focus-ring" disabled={index === 0 || error} onClick={() => setIndex(index - 1)}>上一题</button>
        <button type="button" className="ds-btn-soft jq-grow focus-ring" disabled={index === part.questions.length - 1 || error} onClick={() => setIndex(index + 1)}>下一题</button>
      </div>
      <div className="jq-question-grid" aria-label="题号">
        {part.questions.map((q, number) => <button type="button" key={q.id} disabled={error}
          aria-current={number === index ? "step" : undefined} aria-label={`第 ${number + 1} 题，${choices[q.id] ? "已答" : "未答"}`}
          className={`jq-number focus-ring ${choices[q.id] ? "jq-number-answered" : ""} ${number === index ? "jq-number-current" : ""}`}
          onClick={() => setIndex(number)}>{number + 1}</button>)}
      </div>
    </div>
    {error ? <>
      <MascotSay sticker="mood-puzzled" tone="warn" className="ds-say-onbg">作答没存好。再试一次。</MascotSay>
      <button type="button" className="ds-btn jq-wide focus-ring" onClick={retry}>重试保存</button>
    </> : confirm === "submit" ? <>
      <MascotSay sticker="mood-ask" tone="warn" className="ds-say-onbg">{answered < part.questions.length ? `还有 ${part.questions.length - answered} 题没答。交这一部分？` : "交这一部分？"}</MascotSay>
      <div className="jq-actions">
        <button type="button" className="ds-btn-soft jq-grow focus-ring" onClick={() => setConfirm(null)}>继续答题</button>
        <button type="button" className="ds-btn jq-grow focus-ring" onClick={submitPart}>确认交卷</button>
      </div>
    </> : confirm === "exit" ? null : <button type="button" className="ds-btn jq-wide focus-ring" onClick={() => {
      if (Date.now() >= deadline) submitPart();
      else setConfirm("submit");
    }}>交这一部分</button>}
  </>;
}
