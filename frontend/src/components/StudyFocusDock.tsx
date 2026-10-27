import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { useApp } from "../app/AppContext";
import { getStudyFocusSnapshot } from "../lib/study-focus";

const readPaused = (): number | null => {
  try {
    const snapshot = getStudyFocusSnapshot();
    return snapshot.paused ? snapshot.remainingSeconds : null;
  } catch { return null; } // 库还没开
};

/**
 * 倒计时暂停着（人在别的页面）时的常驻浮标：背词页自己有胶囊，其它页面原来完全看不到倒计时。
 * 点一下回背词页接着走。暂停期间秒数不动，一秒读一次只是为了赶上「刚离开 / 被取消」。
 */
export function StudyFocusDock() {
  const { navigate } = useApp();
  const [remaining, setRemaining] = useState(readPaused);
  useEffect(() => {
    const tick = () => setRemaining(readPaused());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);
  if (remaining === null) return null;
  return (
    <button type="button" className="study-focus-dock focus-ring" onClick={() => navigate("word")}>
      <Timer size={16} />
      <b>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</b>
      <span>已暂停 · 回去继续</span>
    </button>
  );
}
