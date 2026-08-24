import { useState } from "react";
import type { LevelProgressItem, ProgressOverview } from "../lib/api";
import type { ProgressFocus } from "../types/app";
import type { JLPTLevel } from "../types/grammar";

/**
 * 进度概览(动物园配色版) —— 原工具箱里的 ProgressOverviewPanel 搬到主页后重做的皮。
 * 结构不变:单词/语法两组 JLPT 柱状图 + 双栏/单词/语法三档切换,
 * 触屏上左右滑也能切(桌面端不再监听 pointer,免得按住拖一下就跳档)。
 *
 * **每根柱子自己是一个按钮**：点 N5 那根 = 打开 N5 的全部词(语法则跳语法库)。
 * 所以「切双栏/单栏」只留在顶部三个 tab 和左右滑上 —— 整列同时也是切档按钮的话,
 * 一次点击就有两个含义,而且 button 套 button 本身也不合法。
 */

const JLPT_LEVELS: JLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

/** 手势切换的最小位移,低于这个当误触 */
const SWIPE_THRESHOLD = 38;

interface Props {
  overview: ProgressOverview;
  /** 单词柱下钻：打开这个等级的词库 */
  onOpenWordList: (level?: string) => void;
  /** 语法柱下钻：打开语法库并预设等级 */
  onOpenGrammar: (level: JLPTLevel) => void;
}

export function ZooProgressPanel({ overview, onOpenWordList, onOpenGrammar }: Props) {
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
      (level) => byLevel.get(level) ?? { level, total: 0, seen: 0, completed: 0, low: 0, unseen: 0 }
    );
    return (
      <div className={`zoo-prog-col${focus === target ? " on" : ""}`}>
        <button
          className="zoo-prog-col-head"
          onClick={() => setFocus(focus === target ? "both" : target)}
        >
          <b>{title}</b>
          <small>{summary}</small>
        </button>
        <span className="zoo-prog-bars">
          {bars.map((item) => {
            // 柱子画的是「学过多少」。用 completed(已掌握)画的话,两个月的用户
            // 五根柱子全是个位数,看着像什么都没学 —— 掌握度另外在概要里给数字。
            const percent = item.total ? Math.round((item.seen / item.total) * 100) : 0;
            return (
              <button
                key={item.level}
                className="zoo-prog-bar"
                onClick={() => (target === "words" ? onOpenWordList(item.level) : onOpenGrammar(item.level as JLPTLevel))}
                aria-label={`${item.level} ${title} ${item.seen}/${item.total}，点开看全部`}
              >
                <span className="zoo-prog-bar-track">
                  {/* 已有进度但不足 8% 时给个最小高度,不然柱子看不见 */}
                  <i style={{ height: `${Math.max(percent, item.seen ? 8 : 0)}%` }} />
                </span>
                <b>{item.level}</b>
                <small>{percent}%</small>
              </button>
            );
          })}
        </span>
      </div>
    );
  };

  const grammarSeen = overview.grammar.reduce((sum, item) => sum + item.seen, 0);
  const grammarMastered = overview.grammar.reduce((sum, item) => sum + item.completed, 0);
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
            `学过 ${overview.words.seen}/${overview.words.total} · 掌握 ${overview.words.completed} · 薄弱 ${overview.words.low} · 未学 ${overview.words.unseen}`,
            overview.wordsByLevel,
            "words"
          )}
        {(focus === "both" || focus === "grammar") &&
          renderColumn(
            "语法",
            `学过 ${grammarSeen}/${grammarTotal} · 掌握 ${grammarMastered}`,
            overview.grammar,
            "grammar"
          )}
      </div>
    </div>
  );
}
