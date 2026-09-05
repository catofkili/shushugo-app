import { Flame } from "lucide-react";
import { useEffect, useState } from "react";
import { getWordStats, markTodayWordCheckin } from "../lib/api";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import { computeStreak, weekDays } from "../lib/zoo-streak";
import { playStreakChirp, playYuzuPlop } from "../lib/zoo-sounds";
import type { WordStats } from "../types/vocabulary";
import type { Page } from "../types/app";
import { CapybaraMascot } from "../components/CapybaraMascot";

/**
 * 连续打卡 = 水豚泡温泉。
 * 打卡当天 → 一颗柚子「噗」地落到水豚头上(配水声);连续 N 天 = 已泡 N 天。
 * 断签不画惩罚:水豚只是在池边等你,毛有点干。
 *
 * 打卡只能靠真的复习:今日任务没做完时按钮把人送去单词学习,不允许空手打卡。
 */

const WEEK_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

export function HotSpringPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [stats, setStats] = useState<WordStats | null>(null);
  const [drop, setDrop] = useState(0); // 每次 +1 重挂柚子,触发下落动画
  const [error, setError] = useState("");

  useEffect(() => {
    const refresh = () => {
      try {
        setStats(getWordStats());
      } catch (err) {
        setError(err instanceof Error ? err.message : "读取打卡记录失败");
      }
    };
    refresh();
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
  }, []);

  const today = stats?.studyDate ?? "";
  const checkins = stats?.checkins ?? [];
  const checkedInToday = checkins.includes(today);
  const streak = stats ? computeStreak(checkins, today) : 0;
  const week = stats ? weekDays(today) : [];
  const taskDone = !!stats && stats.stage1ProgressTotal > 0 && stats.dailyPlanDone;

  const checkIn = () => {
    try {
      setStats(markTodayWordCheckin());
      setDrop((value) => value + 1);
      playYuzuPlop();
      window.setTimeout(() => playStreakChirp(), 420);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打卡失败");
    }
  };

  return (
    <div className="zoo-page">
      <p className="zoo-panel-kick">STREAK · 水豚温泉</p>
      <h2 className="zoo-panel-title">连续打卡，是水豚泡了几天温泉</h2>

      <div className="zoo-panel zoo-hs-card">
        <div className="zoo-hs-pool">
          {drop > 0 && (
            <span key={drop} className="zoo-hs-yuzu">
              🍊
            </span>
          )}
          <div className="zoo-hs-capy">
            <CapybaraMascot size={104} mood={checkedInToday ? "cheer" : "happy"} />
          </div>
          <div className="zoo-hs-water">
            {drop > 0 && <span key={`ripple-${drop}`} className="zoo-hs-ripple" />}
          </div>
          {/* 蒸汽放在水面外面:水面是 overflow:hidden,放里面会被裁掉 */}
          <span className="zoo-hs-steam s1" />
          <span className="zoo-hs-steam s2" />
        </div>

        <div className="zoo-hs-meta">
          <b><Flame size={14} aria-hidden="true" /> 连续 {streak} 天</b>
          <span>
            {checkedInToday
              ? "今天泡好啦，柚子也落下来了 🍊"
              : taskDone
                ? "今天的词已经复习完，可以下水泡汤了"
                : "今天还没下水——完成今日复习就能泡汤"}
          </span>
        </div>

        <div className="zoo-hs-week">
          {week.map((day, index) => {
            const on = checkins.includes(day);
            return (
              <div key={day} className="zoo-hs-day">
                <i className={on ? "on" : ""}>{on ? "🦫" : "·"}</i>
                <small>{WEEK_LABELS[index]}</small>
              </div>
            );
          })}
        </div>

        {checkedInToday ? (
          <button className="zoo-hs-btn is-done" disabled>
            今天已经泡过啦
          </button>
        ) : taskDone ? (
          <button className="zoo-pop zoo-gloss zoo-hs-btn" onClick={checkIn}>
            下水泡汤 → 打今天的卡
          </button>
        ) : (
          <button className="zoo-pop zoo-gloss zoo-hs-btn" onClick={() => onNavigate("word")}>
            去完成今日复习 →
          </button>
        )}

        {error && <p className="zoo-hs-error">{error}</p>}
      </div>

      <p className="zoo-panel-note">
        断签不惩罚：水豚只是在池边等你，毛有点干。回归时它开心地重新下水，而不是让你负罪补课。
      </p>
    </div>
  );
}
