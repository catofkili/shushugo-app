import { Pause } from "lucide-react";

/** 每题倒计时：一圈细环，最后 5 秒变暖色；切走时停住并显示暂停符号。 */
export const TimerRing = ({ remaining, total, paused }: { remaining: number; total: number; paused: boolean }) => {
  const circumference = 97.4;
  const ratio = total ? Math.max(0, Math.min(1, remaining / total)) : 0;
  return (
    <span className={`vt-timer ${remaining <= 5 && !paused ? "is-low" : ""}`} role="timer" aria-label={paused ? "已暂停" : `剩 ${remaining} 秒`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" className="vt-timer-track" />
        <circle cx="18" cy="18" r="15.5" className="vt-timer-fill" style={{ strokeDasharray: `${ratio * circumference} ${circumference}` }} />
      </svg>
      <b>{paused ? <Pause size={13} /> : remaining}</b>
    </span>
  );
};
