import { useState } from "react";
import { CapybaraMascot } from "../../src/components/CapybaraMascot";
import { playYuzuPlop, playStreakChirp } from "../sounds";

/**
 * 连续打卡 = 水豚泡温泉。
 * 完成今日任务 → 一颗柚子「噗」地落到水豚头上(配水声);连续 N 天 = 已泡 N 天。
 * 断签不画惩罚:水豚只是在池边等你,毛有点干(和 comeback「温和摊还」哲学一致)。
 */

const WEEK = ["月", "火", "水", "木", "金", "土", "日"];

export function HotSpring() {
  const [streak, setStreak] = useState(23);
  const [doneToday, setDoneToday] = useState(false);
  const [drop, setDrop] = useState(0); // 触发柚子下落动画
  const [ripple, setRipple] = useState(0);
  const weekDone = 4; // 本周已 4 天

  const complete = () => {
    if (doneToday) return;
    setDoneToday(true);
    setStreak((s) => s + 1);
    setDrop((d) => d + 1);
    setRipple((r) => r + 1);
    playYuzuPlop();
    setTimeout(() => playStreakChirp(), 420);
  };

  const reset = () => {
    setDoneToday(false);
    setStreak(23);
  };

  return (
    <div>
      <p className="kicker">STREAK · 水豚温泉</p>
      <h2 className="section-title">连续打卡，是水豚泡了几天温泉</h2>

      <div className="lab-card hs-card">
        <div className="hs-pool">
          {/* 柚子下落 */}
          {drop > 0 && (
            <span key={drop} className="hs-yuzu">
              🍊
            </span>
          )}
          {/* 水豚 */}
          <div className="hs-capy">
            <CapybaraMascot size={104} mood={doneToday ? "cheer" : "happy"} />
          </div>
          {/* 水面 + 波纹 */}
          <div className="hs-water">
            {ripple > 0 && <span key={ripple} className="hs-ripple" />}
            <span className="hs-steam s1">˚</span>
            <span className="hs-steam s2">˚</span>
          </div>
        </div>

        <div className="hs-meta">
          <b>🔥 连续 {streak} 天</b>
          <span>{doneToday ? "今天泡好啦，柚子也落下来了 🍊" : "今天还没下水——完成任务就下水泡汤"}</span>
        </div>

        <div className="hs-week">
          {WEEK.map((d, i) => (
            <div key={d} className="hs-day">
              <i className={i < weekDone || (i === weekDone && doneToday) ? "on" : ""}>
                {i < weekDone || (i === weekDone && doneToday) ? "🦫" : "·"}
              </i>
              <small>{d}</small>
            </div>
          ))}
        </div>

        <button className="hs-btn" onClick={doneToday ? reset : complete}>
          {doneToday ? "重来看看" : "完成今日任务 → 下水泡汤"}
        </button>
      </div>

      <p className="lab-note">
        断签不惩罚：水豚只是在池边等你，毛有点干。回归时它开心地重新下水，而不是让你负罪补课。
      </p>
    </div>
  );
}
