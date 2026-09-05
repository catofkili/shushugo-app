import { useEffect, useState } from "react";
// 图标统一走 lucide（ISC 协议，线性、单色、跟随 currentColor）。
// ⚠️ **只换「图标」，不换「角色」**：松鼠🐿️、松子🌰、队友头像、纸屑是内容不是图标，
// lucide 里也根本没有松鼠和温泉 —— 换掉等于把这个 App 的性格删了。
import {
  Bath, Flame, Library, Map, Merge, PawPrint, Puzzle, RefreshCw, Ruler,
  SkipForward, SlidersHorizontal, Speech, Star
} from "lucide-react";
import { getWordStats, type ProgressOverview } from "../lib/api";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import { computeStreak } from "../lib/zoo-streak";
import { computeBadges } from "../lib/zoo-badges";
import type { WordStats } from "../types/vocabulary";
import type { Page, StudyMode } from "../types/app";
import type { JLPTLevel } from "../types/grammar";
import { VISIBLE_STUDY_MODES, studyModeInfo } from "../lib/studyMode";
import { getJlptPlanStatus, type JlptPlanStatus } from "../lib/jlpt/status";
import { shortfallText } from "../lib/jlpt/plan";
import { useCountUp } from "../hooks/useCountUp";
import { useMoments } from "../hooks/useMoments";
import { CapybaraMascot } from "./CapybaraMascot";
import { MomentPop } from "./MomentPop";
import { ZooProgressPanel } from "./ZooProgressPanel";

/**
 * 主页 —— 取代原来的「工具箱」页,工具箱里的每一项都在这里有入口:
 *   学习模式 / 收藏 / 进度概览 / 刷新进度 / 一键完成今日单词。
 *
 * 布局用便当式(bento)网格 + 分区标题,而不是把功能竖着一条条堆:
 *   ① 今天要做什么(今日复习 + 组队,通栏,最显眼)
 *   ② 我的动物园(进度地图 / 温泉 / 图鉴)
 *   ③ 学习工具(学习模式 / 收藏)
 *   ④ 进度概览(柱状图)
 *   ⑤ 进度维护(折叠起来:刷新 / 一键完成,都是低频且有副作用的操作)
 *
 * 数字全部来自本地真实进度(getWordStats / ProgressOverview),没有占位。
 */

type Props = {
  overview: ProgressOverview;
  onNavigate: (page: Page) => void;
  /** 打开词库/选词页，可以预设一个等级（进度概览的柱子就是这么下钻的） */
  onOpenWordList: (level?: string) => void;
  /** 语法柱下钻：打开语法库并预设等级 */
  onOpenGrammarLevel: (level: JLPTLevel) => void;
  /** 大按钮:按上次用过的模式直接开学 */
  onStartStudy: () => void;
  /** 小入口:换一个模式并立刻开学 */
  onStartMode: (mode: StudyMode) => void;
  /** 上次用过的模式(没有记录就是经典) */
  activeMode: StudyMode;
  onRefreshOverview: () => void;
  onCompleteTodayWords: () => void;
  /** 合并老库里重复录入的词条（同一个词两行） */
  onMergeDuplicates: () => void;
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
  onOpenWordList,
  onOpenGrammarLevel,
  onStartStudy,
  onStartMode,
  activeMode,
  onRefreshOverview,
  onCompleteTodayWords,
  onMergeDuplicates
}: Props) {
  const [stats, setStats] = useState<WordStats | null>(null);
  const [jlpt, setJlpt] = useState<JlptPlanStatus | null>(null);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const { moment, leaving: momentLeaving, collect: collectMoments } = useMoments();

  useEffect(() => {
    const refresh = () => {
      try {
        const next = getWordStats();
        setStats(next);
      } catch {
        // 词库还没加载好时先留空,进度事件会再触发一次
        return;
      }
      // 关掉备考计划的人不该在首页看到它,所以 enabled 为假时直接清空
      try {
        const plan = getJlptPlanStatus();
        setJlpt(plan.enabled ? plan : null);
      } catch {
        setJlpt(null);
      }
      // 必须在 stats 读完之后:当天的计划是在那里面排好的,
      // 排之前问 plan_trend 会看到「今天 0 个」,报出一句假喜讯。
      collectMoments();
    };
    refresh();
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
  }, [collectMoments]);

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
    // 当前园区看的是「走到哪儿了」,所以用学过的比例;掌握度(180 天间隔)是另一条线
    pct: Math.round((item.seen / item.total) * 100)
  }));
  const current = withPct.find((item) => item.pct < 100) ?? withPct[withPct.length - 1];

  const badges = computeBadges({
    overview,
    checkins: stats?.checkins ?? [],
    studyDate: stats?.studyDate ?? ""
  });
  const unlockedBadges = badges.filter((badge) => badge.unlocked).length;
  const badgeCount = useCountUp(unlockedBadges);
  const streakCount = useCountUp(streak);

  // 问候语只说**别处没说过的**：剩余量顶栏的松鼠条和大卡已经各写了一遍。
  // 这里给的是当天的状态和连击 —— 同一屏里同一个数字出现三次，是这页显吵的主因之一。
  const greetLine = !stats
    ? "正在读取今天的计划…"
    : total === 0
      ? "今天还没排计划，进去就自动排上"
      : remaining === 0
        ? "今天的路走完了，松子都捡齐啦 🌰"
        : streak > 0
          ? `连着 ${streak} 天没断，松鼠在路口等你`
          : "松鼠已经在路口了";

  // 大按钮说的是「当前有效模式现在有多少题」,而不是永远播报今日计划 ——
  // 正常模式完成后,当前有效模式会在当天临时变成错题本。
  // 停在错题本却写着「今日复习 985 词」正是上次那个坑的一半成因。
  const activeInfo = studyModeInfo(activeMode);
  const activeCount = stats?.modeCounts?.[activeMode] ?? 0;
  const isPlanMode = activeMode === "classic" || activeMode === "quick" || activeMode === "mixed";
  // 学完一批回来是 688 → 670,以前直接跳过去,等于没发生。滚下去才看得见自己按下了它。
  const heroCount = useCountUp(activeCount);
  // 混合模式的合计里有语法条数，写「词」就是假的 —— 单位跟着口径走。
  const heroUnit = activeMode === "mixed" ? "项" : "词";
  const heroNum = !stats
    ? "…"
    : activeCount > 0
      ? `${heroCount} ${heroUnit}`
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
    <div className="zoo-page zoo-home-v2">
      {/* 问候条。**不再重复「今天还有 N 个词」** —— 顶栏的松鼠条和下面的大卡各说了一遍，
          第一屏说三遍是这一页显得吵的主要原因之一。这里只说别处没有的：连击和今天的状态。 */}
      <div className="zoo-greet">
        <div className="zoo-greet-capy zoo-breathe">
          <CapybaraMascot size={56} mood={remaining === 0 && total > 0 ? "cheer" : "happy"} />
        </div>
        <div className="zoo-greet-text">
          <p className="zoo-greet-hi">{greet}</p>
          <p className="zoo-greet-sub">{greetLine}</p>
        </div>
        {streak > 0 && (
          <div className="zoo-greet-streak">
            <Flame size={14} aria-hidden="true" /><b>{streakCount}</b>
          </div>
        )}
      </div>

      {/* ① 今天 —— 全页唯一的实心主色块。层级靠三件事拉开：最大、最亮、字最重。
             模式切换从旁边那张 119px 的大卡收进大卡右下角的一枚 chip：
             它是「改设置」，不该和「开始学」抢同一个视觉重量。 */}
      <section className="zoo-tray zoo-tray-today">
        <button className="zoo-now" onClick={onStartStudy}>
          <span className="zoo-now-kick">{activeInfo.title}</span>
          <b className="zoo-now-num">{heroNum}</b>
          <span className="zoo-now-sub">{heroSub}</span>
          {/* 大卡上那个 40px 的数是今天的合计,看不出里面有没有新词 —— 而「今天学几个新词」
              是全 App 唯一需要用户自己调的量(设置里的学习强度),之前只在改设置那一刻
              弹个 toast 说一遍，之后再也找不到。这行是那个大数的脚注:同一个总量的拆分,
              不是第二个数字,所以两栏加起来必须等于大卡的合计(减负卡和压轴并进复习栏)。 */}
          {/* 混合模式的脚注换成「单词 · 语法」：那个大数是两件事的合计，
              而「今天还欠几条语法」在别处一个字都没有。两栏照样加起来等于大卡的数。 */}
          {activeMode === "mixed" && stats ? (
            <span className="zoo-now-split">
              单词 <b>{Math.max(stats.modeCounts.mixed - stats.grammarRemaining, 0)}</b>
              <i aria-hidden="true">·</i>
              语法 <b>{stats.grammarRemaining}</b>
            </span>
          ) : isPlanMode && stats && stats.stage1NewTotal + stats.stage1ReviewTotal > 0 && (
            <span className="zoo-now-split">
              新词 <b>{stats.stage1NewDone}</b>/{stats.stage1NewTotal}
              <i aria-hidden="true">·</i>
              复习 <b>{stats.stage1ReviewDone}</b>/{stats.stage1ReviewTotal}
            </span>
          )}
          <MomentPop moment={moment} leaving={momentLeaving} />
          <span className="zoo-now-emoji" aria-hidden="true"><activeInfo.Icon size={38} strokeWidth={1.5} /></span>
          <span className="zoo-now-go">{heroCta}</span>
        </button>

        <div className="zoo-now-foot">
          <button
            className="zoo-mode-chip"
            onClick={() => setModeSheetOpen((open) => !open)}
            aria-expanded={modeSheetOpen}
          >
            <SlidersHorizontal size={12} aria-hidden="true" /> 学习方式 · <b>{activeInfo.short}</b> {modeSheetOpen ? "▴" : "▾"}
          </button>
        </div>

        {modeSheetOpen && (
          <div className="zoo-modes-sheet" role="menu">
            {VISIBLE_STUDY_MODES.map((mode) => {
              const count = stats?.modeCounts?.[mode.id] ?? 0;
              const active = mode.id === activeMode;
              return (
                <button
                  key={mode.id}
                  role="menuitem"
                  className={`zoo-modes-item ${active ? "on" : ""}`}
                  onClick={() => { setModeSheetOpen(false); onStartMode(mode.id); }}
                >
                  <span className="zoo-modes-item-emoji" aria-hidden="true"><mode.Icon size={20} /></span>
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

        {/* 今天还要知道的两件事。它们是 T2：描边不填色、字号比大卡小一档，
            并排放在同一个盘子里 —— 各自独立成卡时，视觉重量和大卡是一个量级。 */}
        <div className="zoo-duo">
          {jlpt && (
            <button className="zoo-duo-cell" onClick={() => onNavigate("jlpt-plan")}>
              <span className="zoo-duo-kick">{jlpt.target} 备考</span>
              <b>{jlpt.plan.daysLeft < 0 ? "已考完" : `还有 ${jlpt.plan.daysLeft} 天`}</b>
              <small>{shortfallText(jlpt.shortfall)}</small>
            </button>
          )}
          {/* 组队还没接后端(TeamPage 顶上写着这句)。首页原来写的是「我的队伍 · N3 冲刺组 ·
              看看今天谁下水了」—— 那是把一支不存在的队伍当成用户自己的队伍在播报,
              进去才被告知是示例。入口留着(接了后端就改回来),但首页这行必须说实话。 */}
          <button className="zoo-duo-cell" onClick={() => onNavigate("team")}>
            <span className="zoo-duo-kick">组队</span>
            <b>还没开放</b>
            <small className="zoo-duo-avatars">
              <i>🦫</i><i>🐰</i><i>🦊</i><i>🐿️</i>
              <em>界面预览 · 队友是示例</em>
            </small>
          </button>
        </div>
      </section>

      {/* ② 我的动物园 —— 三件事合成一条。它们是「看一眼的状态」不是「每天要点的功能」，
             各占一个正方格是给了过高的待遇。 */}
      <section className="zoo-tray">
        <p className="zoo-tray-title">我的动物园</p>
        <div className="zoo-strip3">
          <button onClick={() => onNavigate("zoo-map")}>
            <span aria-hidden="true"><Map size={17} /></span>
            <b>{current ? `${current.level} ${current.pct}%` : "未开园"}</b>
            <small>{current ? HABITAT_NAMES[current.level] ?? "进度地图" : "进度地图"}</small>
          </button>
          <button onClick={() => onNavigate("hot-spring")}>
            <span aria-hidden="true"><Bath size={17} /></span>
            <b>{streak > 0 ? `连续 ${streak} 天` : "还没连击"}</b>
            <small>{checkedInToday ? "今天已泡" : "今天还没下水"}</small>
          </button>
          <button onClick={() => onNavigate("zoo-dex")}>
            <span aria-hidden="true"><PawPrint size={17} /></span>
            <b>{badgeCount} / {badges.length}</b>
            <small>饲养员图鉴</small>
          </button>
        </div>
      </section>

      {/* ③ 学习工具 —— 一个盘子里的四格。去掉各自的描边和说明书副标题：
             「同音 · 自他 · 近义词对照」第一次有用，第一百次是噪音。 */}
      <section className="zoo-tray">
        <p className="zoo-tray-title">学习工具</p>
        <div className="zoo-quad">
          <button onClick={() => onNavigate("study-modes")}>
            <span aria-hidden="true"><SlidersHorizontal size={21} /></span>
            <b>学习模式</b>
          </button>
          <button onClick={() => onOpenWordList()}>
            <span aria-hidden="true"><Library size={21} /></span>
            <b>选词</b>
          </button>
          <button onClick={() => onNavigate("confusion")}>
            <span aria-hidden="true"><Puzzle size={21} /></span>
            <b>疑难辨析</b>
          </button>
          <button onClick={() => onNavigate("kanji-readings")}>
            <span aria-hidden="true"><Speech size={21} /></span>
            <b>一字多音</b>
          </button>
          <button onClick={() => onNavigate("favorites")}>
            <span aria-hidden="true"><Star size={21} /></span>
            <b>收藏</b>
          </button>
          <button onClick={() => onNavigate("vocab-test")}>
            <span aria-hidden="true"><Ruler size={21} /></span>
            <b>查词汇量</b>
          </button>
        </div>
      </section>

      {/* ④ 进度概览 —— 默认只给一行数，柱状图收进折叠里。
             十根柱子里七根是 0%，常驻 291px 去展示这个不划算。 */}
      <section className="zoo-tray">
        <details className="zoo-fold">
          <summary>
            <span className="zoo-tray-title">进度概览</span>
            <small>
              单词 {overview.words.seen}/{overview.words.total} · 掌握 {overview.words.completed} · 薄弱 {overview.words.low}
            </small>
          </summary>
          <ZooProgressPanel overview={overview} onOpenWordList={onOpenWordList} onOpenGrammar={onOpenGrammarLevel} />
        </details>
      </section>

      {/* ⑤ 进度维护:低频 + 有副作用,默认收起来 */}
      <details className="zoo-maint">
        <summary>
          进度维护
          <small>刷新 · 合并重复词条 · 一键完成今日单词</small>
        </summary>
        <div className="zoo-maint-body">
          <button className="zoo-pop zoo-maint-btn" onClick={onRefreshOverview}>
            <b><RefreshCw size={13} aria-hidden="true" /> 刷新进度</b>
            <small>重新从本地数据库读一遍统计</small>
          </button>
          <button className="zoo-pop zoo-maint-btn" onClick={onMergeDuplicates}>
            <b><Merge size={13} aria-hidden="true" /> 合并重复词条</b>
            <small>老库里同一个词录了两遍的，把记录并到一行（会先存恢复点）</small>
          </button>
          <button className="zoo-pop zoo-maint-btn warn" onClick={onCompleteTodayWords}>
            <b><SkipForward size={13} aria-hidden="true" /> 一键完成今日单词</b>
            <small>跳过今天的复习，直接进完成页</small>
          </button>
        </div>
      </details>
    </div>
  );
}
