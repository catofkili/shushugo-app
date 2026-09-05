import { useMemo, useState } from "react";
import type { LevelProgressItem, ProgressOverview } from "../lib/api";
import type { ProgressFocus } from "../types/app";
import type { JLPTLevel } from "../types/grammar";
import { dailyStudyLoad, type DailyLoadBar } from "../lib/study-load";

/**
 * 进度概览(动物园配色版) —— 原工具箱里的 ProgressOverviewPanel 搬到主页后重做的皮。
 * 三档:单词 / 语法 两组 JLPT 柱状图,外加「每日」的学习量曲线。
 * 触屏上左右滑也能切档(桌面端不再监听 pointer,免得按住拖一下就跳档)。
 *
 * **每根柱子自己是一个按钮**：点 N5 那根 = 打开 N5 的全部词(语法则跳语法库)。
 * 所以切档只留在顶部三个 tab 和左右滑上 —— 整列同时也是切档按钮的话,
 * 一次点击就有两个含义,而且 button 套 button 本身也不合法。
 *
 * ⚠️ **「双栏」那一档删了。** 两栏并排时每栏只剩半个屏宽:五根柱子挤成竹签、
 * 摘要那行折成两行,信息密度反而比单栏低,还得靠一条 CSS(min-height:2.8em)
 * 硬撑着让两侧柱状图对齐。想比较两边就左右滑一下,比同时看两个小图清楚。
 */

const JLPT_LEVELS: JLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];
const FOCUS_ORDER: ProgressFocus[] = ["words", "grammar", "daily"];
const FOCUS_LABEL: Record<ProgressFocus, string> = {
  words: "单词",
  grammar: "语法",
  daily: "每日"
};

/** 手势切换的最小位移,低于这个当误触 */
const SWIPE_THRESHOLD = 38;

const PAST_DAYS = 14;
const FUTURE_DAYS = 7;

const monthDay = (date: string) => {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
};

interface Props {
  overview: ProgressOverview;
  /** 单词柱下钻：打开这个等级的词库 */
  onOpenWordList: (level?: string) => void;
  /** 语法柱下钻：打开语法库并预设等级 */
  onOpenGrammar: (level: JLPTLevel) => void;
}

/**
 * 每日学习数量：左边是发生过的事，右边是排出来的账。**只说经典模式（正向）** ——
 * 单位因此是「词」不是「张」，和主页大卡的「320 词」是同一把尺子。
 *
 * 口径和 ⚠️ 都在 lib/study-load.ts 上；这里只负责画。预计那几根用虚边 + 淡色，
 * **一定要和实际那几根长得不一样** —— 同样实心的话，这张图就成了在承诺未来。
 */
const DailyLoadChart = () => {
  const load = useMemo(
    () => dailyStudyLoad({ pastDays: PAST_DAYS, futureDays: FUTURE_DAYS }),
    []
  );
  const [picked, setPicked] = useState<string | null>(null);
  const total = (bar: DailyLoadBar) => bar.fresh + bar.review + bar.pending;
  const max = Math.max(...load.bars.map(total), 1);
  const current = load.bars.find((bar) => bar.date === picked)
    ?? load.bars.find((bar) => bar.today)
    ?? load.bars[0];
  const lastIndex = load.bars.length - 1;
  // 刻度只标三处，而且**长在柱子自己身上** —— 单独摆一行 space-between 的话，
  // 「今天」会飘到正中间，而它实际在第 14 根，指的就成了别的日子。
  const tick = (bar: DailyLoadBar, index: number) => {
    if (bar.today) return "今天";
    if (index === 0 || index === lastIndex) return monthDay(bar.date);
    return "";
  };

  return (
    <div className="zoo-load">
      <div className="zoo-load-head">
        <b>每日学习数量</b>
        <small>
          经典模式 · 过去 {PAST_DAYS} 天日均 {load.pastAverage} 词 · 往后 {FUTURE_DAYS} 天预计日均 {load.forecastAverage} 词
        </small>
      </div>

      <div className="zoo-load-chart">
        {load.bars.map((bar, index) => {
          // 不足 1% 的那截会被抹平成看不见，给非零的一律留 2px。
          // ⚠️ 用 minHeight 而不是 height:max(…%,2px)：`max()` 写在 flex 子项的
          // 内联 height 上，实测在 WebView 里不生效，整排柱子会塌成一条。
          const seg = (value: number) => ({
            height: `${(value / max) * 100}%`,
            minHeight: value > 0 ? 2 : 0
          });
          const label = `${monthDay(bar.date)}${bar.forecast ? " 预计" : ""} 新学 ${bar.fresh}、复习 ${bar.review}${bar.pending ? `、还剩 ${bar.pending}` : ""}`;
          return (
            <button
              key={bar.date}
              type="button"
              onClick={() => setPicked(bar.date)}
              aria-label={label}
              aria-pressed={current?.date === bar.date}
              className={`zoo-load-bar${bar.forecast ? " fc" : ""}${bar.today ? " now" : ""}${current?.date === bar.date ? " on" : ""}`}
            >
              <span className="zoo-load-stack">
                {/* 从上到下：还欠的 / 复习 / 新学。新词额度每天几乎是条直线，
                    把它放底下当基座，上面那截的高低才一眼是「复习量在变」 */}
                <i className="pd" style={seg(bar.pending)} />
                <i className="rv" style={seg(bar.review)} />
                <i className="fr" style={seg(bar.fresh)} />
              </span>
              <em>{tick(bar, index)}</em>
            </button>
          );
        })}
      </div>

      {current && (
        <p className="zoo-load-detail">
          <b>{monthDay(current.date)}</b>
          {current.forecast ? <span className="zoo-load-tag">预计</span> : null}
          {current.today ? <span className="zoo-load-tag">今天</span> : null}
          新学 {current.fresh} · 复习 {current.review}
          {current.pending > 0 ? ` · 还剩 ${current.pending}` : ""} · 共 {total(current)} 词
        </p>
      )}

      <div className="zoo-load-legend">
        <span><i className="fr" />新学</span>
        <span><i className="rv" />复习</span>
        <span><i className="fc" />还没做 / 预计</span>
      </div>
      <p className="zoo-load-note">
        预计只算了已经排好的到期量和新词额度，<b>是个下限</b>：今天答错的卡过几天还会回来，那部分还没发生。
      </p>
    </div>
  );
};

export function ZooProgressPanel({ overview, onOpenWordList, onOpenGrammar }: Props) {
  const [focus, setFocus] = useState<ProgressFocus>("words");
  const [touchX, setTouchX] = useState<number | null>(null);

  const handleSwipeEnd = (clientX: number) => {
    if (touchX === null) return;
    const delta = clientX - touchX;
    setTouchX(null);
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    // 滑动 = 在三档里前后走一格，走到头就停住（循环的话「往回滑」会跳到最远那档）
    const index = FOCUS_ORDER.indexOf(focus);
    const next = Math.min(Math.max(index + (delta > 0 ? -1 : 1), 0), FOCUS_ORDER.length - 1);
    setFocus(FOCUS_ORDER[next]);
  };

  const renderColumn = (
    title: string,
    summary: string,
    items: LevelProgressItem[],
    target: Exclude<ProgressFocus, "daily">
  ) => {
    const byLevel = new Map(items.map((item) => [item.level, item]));
    const bars = JLPT_LEVELS.map(
      (level) => byLevel.get(level) ?? { level, total: 0, seen: 0, completed: 0, low: 0, unseen: 0 }
    );
    return (
      <div className="zoo-prog-col on">
        <div className="zoo-prog-col-head">
          <b>{title}</b>
          <small>{summary}</small>
        </div>
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
        {FOCUS_ORDER.map((item) => (
          <button
            key={item}
            className={focus === item ? "on" : ""}
            onClick={() => setFocus(item)}
          >
            {FOCUS_LABEL[item]}
          </button>
        ))}
      </div>
      <div
        className="zoo-prog-body"
        onTouchStart={(event) => setTouchX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => handleSwipeEnd(event.changedTouches[0]?.clientX ?? 0)}
      >
        {focus === "words" &&
          renderColumn(
            "单词",
            `学过 ${overview.words.seen}/${overview.words.total} · 掌握 ${overview.words.completed} · 薄弱 ${overview.words.low} · 未学 ${overview.words.unseen}`,
            overview.wordsByLevel,
            "words"
          )}
        {focus === "grammar" &&
          renderColumn(
            "语法",
            `学过 ${grammarSeen}/${grammarTotal} · 掌握 ${grammarMastered}`,
            overview.grammar,
            "grammar"
          )}
        {/* key 让每次切回来重算一次:图里有「今天」,停在后台一整夜再打开不该还是昨天的 */}
        {focus === "daily" && <DailyLoadChart key="daily" />}
      </div>
    </div>
  );
}
