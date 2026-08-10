import { useEffect, useState } from "react";
import { getWordStats, type ProgressOverview } from "../lib/api";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import { computeStreak } from "../lib/zoo-streak";
import { computeBadges } from "../lib/zoo-badges";
import type { WordStats } from "../types/vocabulary";
import type { Page, StudyMode } from "../types/app";
import { STUDY_MODES, studyModeInfo } from "../lib/studyMode";
import { CapybaraMascot } from "./CapybaraMascot";
import { ZooProgressPanel } from "./ZooProgressPanel";

/**
 * 主页 —— 取代原来的「工具箱」页,工具箱里的每一项都在这里有入口:
 *   学习模式 / 收藏 / 进度概览 / 一键填满 / 刷新进度 / 一键完成今日单词。
 *
 * 布局用便当式(bento)网格 + 分区标题,而不是把功能竖着一条条堆:
 *   ① 今天要做什么(今日复习 + 组队,通栏,最显眼)
 *   ② 我的动物园(进度地图 / 温泉 / 图鉴)
 *   ③ 学习工具(学习模式 / 收藏)
 *   ④ 进度概览(柱状图)
 *   ⑤ 进度维护(折叠起来:刷新 / 填满 / 一键完成,都是低频且有副作用的操作)
 *
 * 数字全部来自本地真实进度(getWordStats / ProgressOverview),没有占位。
 */

type Props = {
  overview: ProgressOverview;
  onNavigate: (page: Page) => void;
  /** 大按钮:按上次用过的模式直接开学 */
  onStartStudy: () => void;
  /** 小入口:换一个模式并立刻开学 */
  onStartMode: (mode: StudyMode) => void;
  /** 上次用过的模式(没有记录就是经典) */
  activeMode: StudyMode;
  onOpenFill: () => void;
  onRefreshOverview: () => void;
  onCompleteTodayWords: () => void;
};

const greetingFor = (hour: number) =>
  hour < 5 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

/** 五个等级 = 五个园区 */
const HABITAT_NAMES: Record<string, string> = {
  N5: "水豚温泉",
  N4: "松鼠林",
  N3: "鸟舍",
  N2: "熊猫馆",
  N1: "夜行馆"
};

export function ZooHome({
  overview,
  onNavigate,
  onStartStudy,
  onStartMode,
  activeMode,
  onOpenFill,
  onRefreshOverview,
  onCompleteTodayWords
}: Props) {
  const [stats, setStats] = useState<WordStats | null>(null);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);

  useEffect(() => {
    const refresh = () => {
      try {
        setStats(getWordStats());
      } catch {
        // 词库还没加载好时先留空,进度事件会再触发一次
      }
    };
    refresh();
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
  }, []);

  const greet = greetingFor(new Date().getHours());
  const total = stats?.stage1ProgressTotal ?? 0;
  const done = stats?.stage1ProgressDone ?? 0;
  const remaining = Math.max(0, total - done);
  const streak = stats ? computeStreak(stats.checkins, stats.studyDate) : 0;
  const checkedInToday = !!stats && stats.checkins.includes(stats.studyDate);

  // 当前园区 = 第一个掌握度未满的等级(都满了就停在 N1)
  const levels = overview.wordsByLevel.filter((item) => item.total > 0);
  const withPct = levels.map((item) => ({
    ...item,
    pct: Math.round((item.completed / item.total) * 100)
  }));
  const current = withPct.find((item) => item.pct < 100) ?? withPct[withPct.length - 1];

  const badges = computeBadges({
    overview,
    checkins: stats?.checkins ?? [],
    studyDate: stats?.studyDate ?? ""
  });
  const unlockedBadges = badges.filter((badge) => badge.unlocked).length;

  const subtitle = !stats
    ? "正在读取今天的计划…"
    : remaining > 0
      ? `今天还有 ${remaining} 个词等你，松鼠已经在路口了`
      : total > 0
        ? "今天的路走完了，松子都捡齐啦 🌰"
        : "今天还没排计划，进去就自动排上";

  // 大按钮说的是「上次那个模式现在有多少题」,而不是永远播报今日计划 ——
  // 停在错题本却写着「今日复习 985 词」正是上次那个坑的一半成因。
  const activeInfo = studyModeInfo(activeMode);
  const activeCount = stats?.modeCounts?.[activeMode] ?? 0;
  const isPlanMode = activeMode === "classic" || activeMode === "quick";
  const heroNum = !stats
    ? "…"
    : activeCount > 0
      ? `${activeCount} 词`
      : isPlanMode ? "已完成" : "暂无题";
  const heroSub = !stats
    ? "正在读取"
    : activeMode === "mistakes"
      ? `今天攻掉 ${stats.mistakes.answeredToday} 个`
      : isPlanMode
        ? (activeCount > 0 ? "走一趟捡松子的小路" : `今天捡了 ${done} 颗松子`)
        : activeInfo.subtitle;
  const heroCta = activeCount > 0 ? "开始 →" : isPlanMode ? "再来一批 →" : "去看看 →";

  return (
    <div className="zoo-page">
      {/* 问候条 */}
      <div className="zoo-greet">
        <div className="zoo-greet-capy zoo-breathe">
          <CapybaraMascot size={64} mood={remaining === 0 && total > 0 ? "cheer" : "happy"} />
        </div>
        <div className="zoo-greet-text">
          <p className="zoo-greet-hi">{greet}，继续加油 🌿</p>
          <p className="zoo-greet-sub">{subtitle}</p>
        </div>
        {streak > 0 && (
          <div className="zoo-greet-streak">
            🔥<b>{streak}</b>
          </div>
        )}
      </div>

      {/* ① 今天 —— 大入口按上次的模式直接开学,右边的小入口换模式。
             以前每个模式在这儿各占一个格子(快速复习一格、错题本一格,反向/汉字压根没有入口),
             既占地方又看不出「我现在按哪种方式在学」。 */}
      <div className="zoo-bento zoo-today-grid">
        <button className="zoo-tile zoo-tile-hero" onClick={onStartStudy}>
          <div className="zoo-tile-hero-l">
            <span className="zoo-tile-kick">{activeInfo.title}</span>
            <b className="zoo-tile-hero-num">{heroNum}</b>
            <span className="zoo-tile-hero-sub">{heroSub}</span>
          </div>
          <div className="zoo-tile-hero-r">
            <span className="zoo-tile-hero-emoji">{activeInfo.emoji}</span>
            <span className="zoo-tile-cta">{heroCta}</span>
          </div>
        </button>

        <button
          className="zoo-tile zoo-tile-modes"
          onClick={() => setModeSheetOpen((open) => !open)}
          aria-expanded={modeSheetOpen}
        >
          <span className="zoo-tile-modes-emoji" aria-hidden="true">🎛️</span>
          <span className="zoo-tile-modes-copy">
            <small>学习方式</small>
            <b>{activeInfo.short}</b>
          </span>
          <span className="zoo-tile-modes-caret" aria-hidden="true">{modeSheetOpen ? "▴" : "▾"}</span>
        </button>

        {modeSheetOpen && (
          <div className="zoo-modes-sheet" role="menu">
            {STUDY_MODES.map((mode) => {
              const count = stats?.modeCounts?.[mode.id] ?? 0;
              const active = mode.id === activeMode;
              return (
                <button
                  key={mode.id}
                  role="menuitem"
                  className={`zoo-modes-item ${active ? "on" : ""}`}
                  onClick={() => { setModeSheetOpen(false); onStartMode(mode.id); }}
                >
                  <span className="zoo-modes-item-emoji" aria-hidden="true">{mode.emoji}</span>
                  <span className="zoo-modes-item-copy">
                    <b>{mode.title}</b>
                    <small>{mode.subtitle} · {mode.description}</small>
                  </span>
                  {/* 角标写「现在能练多少」:反向/汉字的队列是进去才建的,
                      不给数字的话这两项看着永远像空的 */}
                  <span className="zoo-modes-item-count">{count > 0 ? count : "—"}</span>
                </button>
              );
            })}
          </div>
        )}

        <button className="zoo-tile zoo-tile-team" onClick={() => onNavigate("team")}>
          <span className="zoo-tile-kick">我的队伍</span>
          <b className="zoo-tile-team-name">N3 冲刺组</b>
          <div className="zoo-tile-team-avatars">
            <i>🦫</i>
            <i>🐰</i>
            <i>🦊</i>
            <i>🐿️</i>
          </div>
          <span className="zoo-tile-team-status">看看今天谁下水了</span>
          <span className="zoo-tile-cta soft">看看队友 →</span>
        </button>
      </div>

      {/* ② 我的动物园 */}
      <p className="zoo-sec">我的动物园</p>
      <div className="zoo-bento">
        <button className="zoo-tile zoo-tile-sm" onClick={() => onNavigate("zoo-map")}>
          <span className="zoo-tile-emoji">🗺️</span>
          <b>进度地图</b>
          <span className="zoo-tile-sub">
            {current ? `${current.level} ${HABITAT_NAMES[current.level] ?? ""} · ${current.pct}%` : "还没有进度"}
          </span>
          <div className="zoo-tile-bar">
            <i style={{ width: `${current?.pct ?? 0}%` }} />
          </div>
        </button>

        <button className="zoo-tile zoo-tile-sm" onClick={() => onNavigate("hot-spring")}>
          <span className="zoo-tile-emoji">♨️</span>
          <b>温泉打卡</b>
          <span className="zoo-tile-sub">
            {streak > 0 ? `连续 ${streak} 天` : "还没开始连击"} · {checkedInToday ? "今天已泡" : "今天还没下水"}
          </span>
        </button>

        {/* 图鉴信息量少,做成通栏矮条,不占一个正方格 */}
        <button className="zoo-tile zoo-tile-strip" onClick={() => onNavigate("zoo-dex")}>
          <span className="zoo-tile-emoji">🐾</span>
          <span className="zoo-tile-strip-text">
            <b>饲养员图鉴</b>
            <span className="zoo-tile-sub">园区认证 · 连击 · 松子收成</span>
          </span>
          <span className="zoo-tile-strip-num">
            {unlockedBadges} / {badges.length}
          </span>
        </button>
      </div>

      {/* ③ 学习工具(原工具箱) */}
      <p className="zoo-sec">学习工具</p>
      <div className="zoo-bento">
        <button className="zoo-tile zoo-tile-sm" onClick={() => onNavigate("study-modes")}>
          <span className="zoo-tile-emoji">🎛️</span>
          <b>学习模式</b>
          <span className="zoo-tile-sub">经典 · 错题本 · 快速 · 反向 · 汉字</span>
        </button>

        <button className="zoo-tile zoo-tile-sm" onClick={() => onNavigate("favorites")}>
          <span className="zoo-tile-emoji">⭐</span>
          <b>收藏</b>
          <span className="zoo-tile-sub">单词和语法的收藏夹</span>
        </button>
      </div>

      {/* ④ 进度概览 */}
      <p className="zoo-sec">进度概览</p>
      <ZooProgressPanel overview={overview} />

      {/* ⑤ 进度维护:低频 + 有副作用,默认收起来 */}
      <details className="zoo-maint">
        <summary>
          进度维护
          <small>刷新 · 一键填满 · 一键完成今日单词</small>
        </summary>
        <div className="zoo-maint-body">
          <button className="zoo-pop zoo-maint-btn" onClick={onRefreshOverview}>
            <b>🔄 刷新进度</b>
            <small>重新从本地数据库读一遍统计</small>
          </button>
          <button className="zoo-pop zoo-maint-btn" onClick={onOpenFill}>
            <b>✅ 一键填满</b>
            <small>把选定等级的单词/语法标记为已掌握</small>
          </button>
          <button className="zoo-pop zoo-maint-btn warn" onClick={onCompleteTodayWords}>
            <b>⏭️ 一键完成今日单词</b>
            <small>跳过今天的复习，直接进完成页</small>
          </button>
        </div>
      </details>
    </div>
  );
}
