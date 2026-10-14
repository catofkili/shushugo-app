import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { triggerMemoryHaptic } from "../lib/haptics";
import { getStudyPreferences } from "../lib/studyPreferences";
import { playDontKnow, playKnow } from "../lib/zoo-sounds";

const PRAISE = ["答对了", "漂亮", "就是它", "稳"];

export function AnswerFeedbackBar({ correct, answer, combo, onContinue, questionNumber = 0 }: {
  correct: boolean;
  answer: string;
  combo: number;
  onContinue: () => void;
  /** 从 0 起的题号，让鼓励文案稳定轮换，与连对数无关。 */
  questionNumber?: number;
}) {
  const played = useRef(false);
  const continued = useRef(false);
  const proceed = () => {
    if (continued.current) return;
    continued.current = true;
    onContinue();
  };
  useEffect(() => {
    // StrictMode 重跑 effect 也只反馈一次；每道题由调用方用 key 或条件卸载隔开。
    if (played.current) return;
    played.current = true;
    triggerMemoryHaptic(correct ? "know" : "forgot");
    if (getStudyPreferences().zooSounds) {
      if (correct) playKnow(combo);
      else playDontKnow();
    }
  }, [combo, correct]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!continued.current) {
          continued.current = true;
          onContinue();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onContinue]);

  return <>
    <div className="answer-feedback-space" aria-hidden="true" />
    {/* 挂到 body：题目页外壳带 transform（入场动画），fixed 会被困在外壳里、压在底栏下面。小程序走 react-dom 替身挂进页面外壳 */}
    {createPortal(<div className={`answer-feedback ${correct ? "answer-feedback-correct" : "answer-feedback-wrong"}`}>
      <div className="answer-feedback-inner">
        <div className="answer-feedback-result" role="status" aria-live="polite">
          {/* Taro 按 #FFFFFF 选择白色图标资源，不继承父级 CSS 的 color。 */}
          <span className="answer-feedback-icon">{correct ? <Check size={24} color="#FFFFFF" /> : <X size={24} color="#FFFFFF" />}</span>
          <div className="answer-feedback-copy">
            <p className="answer-feedback-title">{correct ? PRAISE[questionNumber % PRAISE.length] : "正确答案"}</p>
            {!correct && <p className="answer-feedback-answer">{answer}</p>}
          </div>
        </div>
        <button type="button" className={`ds-btn focus-ring answer-feedback-continue ${correct ? "answer-feedback-primary" : "answer-feedback-amber"}`} onClick={proceed}>继续</button>
      </div>
    </div>, document.body)}
  </>;
}
