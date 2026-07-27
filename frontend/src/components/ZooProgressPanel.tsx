import { useState } from "react";
import type { LevelProgressItem, ProgressOverview } from "../lib/api";
import type { ProgressFocus } from "../types/app";
import type { JLPTLevel } from "../types/grammar";

/**
 * 进度概览(动物园配色版) —— 原工具箱里的 ProgressOverviewPanel 搬到主页后重做的皮。
 * 结构不变:单词/语法两组 JLPT 柱状图 + 双栏/单词/语法三档切换,
 * 触屏上左右滑也能切(桌面端不再监听 pointer,免得按住拖一下就跳档)。
 */

const JLPT_LEVELS: JLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

/** 手势切换的最小位移,低于这个当误触 */
const SWIPE_THRESHOLD = 38;

export function ZooProgressPanel({ overview }: { overview: ProgressOverview }) {
  const [focus, setFocus] = useState<ProgressFocus>("both");
  const [touchX, setTouchX] = useState<number | null>(null);

  const handleSwipeEnd = (clientX: number) => {
    if (touchX === null) return;
    const delta = clientX - touchX;
    setTouchX(null);
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    setFocus(delta > 0 ? "words" : "grammar");
  };

  const renderColumn = (
    title: string,
    summary: string,
    items: LevelProgressItem[],
    target: Exclude<ProgressFocus, "both">
  ) => {
    const byLevel = new Map(items.map((item) => [item.level, item]));
    const bars = JLPT_LEVELS.map(
      (level) => byLevel.get(level) ?? { level, total: 0, completed: 0, low: 0, unseen: 0 }
    );
    return (
      <button
        className={`zoo-prog-col${focus === target ? " on" : ""}`}
        onClick={() => setFocus(focus === target ? "both" : target)}
      >
        <span className="zoo-prog-col-head">
          <b>{title}</b>
          <small>{summary}</small>
        </span>
        <span className="zoo-prog-bars">
          {bars.map((item) => {
            const percent = item.total ? Math.round((item.completed / item.total) * 100) : 0;
            return (
              <span key={item.level} className="zoo-prog-bar">
                <span className="zoo-prog-bar-track">
                  {/* 已有进度但不足 8% 时给个最小高度,不然柱子看不见 */}
                  <i style={{ height: `${Math.max(percent, item.completed ? 8 : 0)}%` }} />
                </span>
                <b>{item.level}</b>
                <small>{percent}%</small>
              </span>
            );
          })}
        </span>
      </button>
    );
  };

  const grammarCompleted = overview.grammar.reduce((sum, item) => sum + item.completed, 0);
  const grammarTotal = overview.grammar.reduce((sum, item) => sum + item.total, 0);

  return (
    <div className="zoo-panel zoo-prog">
      <div className="zoo-prog-tabs">
        {(["both", "words", "grammar"] as ProgressFocus[]).map((item) => (
          <button
            key={item}
            className={focus === item ? "on" : ""}
            onClick={() => setFocus(item)}
          >
            {item === "both" ? "双栏" : item === "words" ? "单词" : "语法"}
          </button>
        ))}
      </div>
      <div
        className={`zoo-prog-body${focus === "both" ? " two" : ""}`}
        onTouchStart={(event) => setTouchX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => handleSwipeEnd(event.changedTouches[0]?.clientX ?? 0)}
      >
        {(focus === "both" || focus === "words") &&
          renderColumn(
            "单词",
            `${overview.words.completed}/${overview.words.total} · 薄弱 ${overview.words.low} · 未学 ${overview.words.unseen}`,
            overview.wordsByLevel,
            "words"
          )}
        {(focus === "both" || focus === "grammar") &&
          renderColumn("语法", `${grammarCompleted}/${grammarTotal}`, overview.grammar, "grammar")}
      </div>
    </div>
  );
}
