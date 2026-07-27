import { useEffect, useState } from "react";
import { getWordStats } from "../lib/api";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import type { WordStats } from "../types/vocabulary";

/**
 * 松鼠捡松子的小路 —— 放在顶部 Master 栏中间那块本来空着的地方。
 * 一场复习 = 一条小路:答对捡起松子往前跳一步,答错松子变空壳、队尾多一站(和 FSRS 重排同构)。
 *
 * 放全局顶栏而不是学习页卡片里:卡片高度是死的,进度条占的每一像素都是从答案区扣的;
 * 而顶栏中间本来就是空的,白捡。副作用是在任何页面都能看到今天走到哪了。
 */

/** 词量大时不逐个画站点(会挤成一团),只保留小路本身和松鼠位置 */
const TRAIL_MAX_NODES = 20;

export function SquirrelTrail() {
  const [stats, setStats] = useState<WordStats | null>(null);

  useEffect(() => {
    const refresh = () => {
      try {
        setStats(getWordStats());
      } catch {
        // 词库还没加载好时先不画,进度事件会再触发一次
      }
    };
    refresh();
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
  }, []);

  const total = stats?.stage1ProgressTotal ?? 0;
  const done = stats?.stage1ProgressDone ?? 0;
  // 今天还没排计划就不占位置
  if (total <= 0) return null;

  const pct = Math.min(100, (done / total) * 100);
  const nodes = total <= TRAIL_MAX_NODES ? Array.from({ length: total }, (_, i) => i) : null;

  return (
    <div className="zoo-trail" title={`今日复习 ${done} / ${total}`}>
      <div className="zoo-trail-line" />
      {nodes && (
        <div className="zoo-trail-stations">
          {nodes.map((i) => (
            <span
              key={i}
              className={`zoo-trail-node ${i < done ? "got" : i === done ? "cur" : "pending"}`}
            >
              {i < done ? "🌰" : "•"}
            </span>
          ))}
        </div>
      )}
      {/* key={done} 让松鼠每前进一步都重播一次跳跃 */}
      <div
        key={done}
        className="zoo-trail-squirrel"
        // 松鼠的活动范围要避开右边的计数,否则走到终点会和数字糊在一起
        style={{ left: `calc(10px + (100% - 10px - var(--zoo-trail-tail)) * ${pct / 100})` }}
      >
        🐿️
      </div>
      <span className="zoo-trail-count">
        <b>{done}</b>/{total} 🌰
      </span>
    </div>
  );
}
