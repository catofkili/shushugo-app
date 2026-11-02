import { STUDY_FOCUS_MINUTES } from "../lib/yuzu";

/** 每段倒计时多长：一排单选。受控，只在主页开场说明里改（点确定才存）；休息页不放，2026-11-02 用户定。 */
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
