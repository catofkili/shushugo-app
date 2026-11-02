import { useState } from "react";
import { getStudyFocusMinutes, setStudyFocusMinutes } from "../lib/study-focus";
import { STUDY_FOCUS_MINUTES } from "../lib/yuzu";

/** 每段倒计时多长：一排单选。受控，开场说明（点确定才存）和休息页（点了就存）各管各的存法。 */
export function StudyFocusMinutes({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  return (
    <div className="study-focus-minutes" role="radiogroup" aria-label="每段倒计时多长">
      {STUDY_FOCUS_MINUTES.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={option === minutes}
          aria-label={`${option} 分钟`} className={`focus-ring${option === minutes ? " is-on" : ""}`} onClick={() => onChange(option)}>
          <b>{option}</b><small>分钟</small>
        </button>
      ))}
    </div>
  );
}

/** 休息页上「下一段多长」：点了立即存，继续倒计时时按它开新的一段。 */
export function StudyFocusNextPicker() {
  const [minutes, setMinutes] = useState(getStudyFocusMinutes);
  return (
    <>
      <p className="study-focus-method">下一段时长 · 继续后从 {minutes}:00 开始</p>
      <StudyFocusMinutes minutes={minutes} onChange={(next) => { setStudyFocusMinutes(next); setMinutes(next); }} />
    </>
  );
}
