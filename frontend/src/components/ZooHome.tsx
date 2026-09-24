import { useEffect, useState } from "react";
// 图标统一走 lucide（ISC 协议，线性、单色、跟随 currentColor）。
// 主页问候区使用收集日品牌图标；其它学习状态仍保留线性图标和吉祥物组件。
import { Flame, Merge, RefreshCw, SkipForward, SlidersHorizontal } from "lucide-react";
import { getWordStats, type ProgressOverview } from "../lib/api";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import { getStudyPreferences, kanaGatePending, PREFERENCES_EVENT } from "../lib/studyPreferences";
import { computeStreak } from "../lib/zoo-streak";
import type { WordStats } from "../types/vocabulary";
import type { Page, StudyMode } from "../types/app";
import type { JLPTLevel } from "../types/grammar";
import { VISIBLE_STUDY_MODES, studyModeInfo } from "../lib/studyMode";
import { getJlptPlanStatus, type JlptPlanStatus } from "../lib/jlpt/status";
import { getWeeklyReportNotice, WEEKLY_REPORT_UPDATED_EVENT } from "../lib/analytics/weekly-reports";
import { availableShortfall, shortfallText } from "../lib/jlpt/plan";
import { useEntitlements } from "../hooks/useEntitlements";
import { useCountUp } from "../hooks/useCountUp";
import { useMoments } from "../hooks/useMoments";
import { Sticker, type StickerName } from "./CapybaraMascot";
import { MomentPop } from "./MomentPop";
import { WeeklyReportEntrance } from "./WeeklyReportEntrance";
import { ZooProgressPanel } from "./ZooProgressPanel";

/**
 * 主页 —— 取代原来的「工具箱」页,工具箱里的每一项都在这里有入口:
 *   学习模式 / 收藏 / 进度概览 / 刷新进度 / 一键完成今日单词。
 *
 * 布局用便当式(bento)网格 + 分区标题,而不是把功能竖着一条条堆:
 *   ① 今天要做什么(今日复习 + 组队,通栏,最显眼)
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
  /** 打开二楼学习回顾；entry 只用于本地观测，区分按钮还是下拉 */
  onOpenWeeklyReport: (entry: "button" | "pull") => void;
};

const greetingFor = (hour: number) =>
  hour < 5 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

/**
 * 问候旁边那只吉祥物跟着「现在几点」换：早上伸懒腰、中午饿了、下午敲电脑、晚上戴耳机、深夜睡着；
 * 今天走完了就换成欢呼。主页是一天打开次数最多的一屏，永远同一张 App 图标等于没有表情。
 * ⚠️ 别和下面大卡那只（按进度换：fired-up / book / cheer）撞成同一张。
 */
const greetSticker = (hour: number, total: number, done: number): StickerName =>
  total > 0 && done >= total ? "mood-yay"
    : hour < 5 || hour >= 23 ? "mood-sleep"
      : hour < 10 ? "scene-stretch"
        : hour < 14 ? "mood-hungry"
          : hour < 18 ? "scene-laptop"
            : "scene-music";

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
  onMergeDuplicates,
  onOpenWeeklyReport
}: Props) {
  const entitlements = useEntitlements();
  const [stats, setStats] = useState<WordStats | null>(null);
  const [jlpt, setJlpt] = useState<JlptPlanStatus | null>(null);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  // 每日量在设置页也能改，所以跟着 PREFERENCES_EVENT 走，别只在挂载时读一次
  const [goals, setGoals] = useState(() => getStudyPreferences());
  // 更新日的新报告提示。只在这一份报告未读、且还在发布窗口内时为真。
  const [weeklyNotice, setWeeklyNotice] = useState<"new" | "read" | "expired" | "none">("none");
  const { moment, leaving: momentLeaving, collect: collectMoments } = useMoments();

  useEffect(() => {
    const refreshWeeklyNotice = () => {
      try {
        setWeeklyNotice(getWeeklyReportNotice().state);
      } catch {
        setWeeklyNotice("none");
      }
    };
    const refresh = () => {
      refreshWeeklyNotice();
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
    const timer = window.setInterval(refreshWeeklyNotice, 60_000);
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    window.addEventListener(WEEKLY_REPORT_UPDATED_EVENT, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
      window.removeEventListener(WEEKLY_REPORT_UPDATED_EVENT, refresh);
    };
  }, [collectMoments]);

  useEffect(() => {
    const sync = () => setGoals(getStudyPreferences());
    window.addEventListener(PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(PREFERENCES_EVENT, sync);
  }, []);

  const greet = greetingFor(new Date().getHours());
  const total = stats?.stage1ProgressTotal ?? 0;
  const done = stats?.stage1ProgressDone ?? 0;
  const remaining = Math.max(0, total - done);
  const streak = stats ? computeStreak(stats.checkins, stats.studyDate) : 0;
  const streakCount = useCountUp(streak);

  // 问候语只说**别处没说过的**：剩余量顶栏的进度条和大卡已经各写了一遍。
  // 这里给的是当天的状态和连击 —— 同一屏里同一个数字出现三次，是这页显吵的主因之一。
  const greetLine = !stats
    ? "正在读取今天的计划…"
    : total === 0
      ? "今天还没排计划"
      : remaining === 0
        ? "今天的路走完了 🎉"
        : streak > 0
          ? `连着 ${streak} 天没断，今天接着走`
          : "今天的路已经排好了";

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
      ? <>{heroCount}<small>{heroUnit}</small></>
      : isPlanMode ? "已完成" : "暂无题";
  // 今天走到哪：只有「按今日计划走」的模式才有这条（错题本 / 反向 / 汉字读音各有各的题池）
  const heroPct = isPlanMode && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  const heroSticker: StickerName = !stats ? "mood-default"
    : activeMode === "mistakes" ? "mood-puzzled"
      : activeCount === 0 ? "mood-cheer"
        : done === 0 ? "mood-fired-up"
          : "scene-book";
  const heroSub = !stats
    ? "正在读取"
    : activeMode === "mistakes"
      ? `今天攻掉 ${stats.mistakes.answeredToday} 个`
      : isPlanMode
        ? (activeCount > 0 ? "走一趟今天的路" : `今天走了 ${done} 站`)
        : activeInfo.subtitle;
  const heroCta = activeCount > 0 ? (done > 0 ? "继续" : "开始") : isPlanMode ? "再来一批" : "去看看";

  const weeklyEntryEnabled = goals.weeklyReportEnabled;

  return (
    <div className={`zoo-page zoo-home-v2${weeklyEntryEnabled ? " has-weekly-cord" : ""}`}>
      {weeklyEntryEnabled && <WeeklyReportEntrance unread={weeklyNotice === "new"} onOpen={onOpenWeeklyReport} />}
      {/* 问候条。**不再重复「今天还有 N 个词」** —— 顶栏的进度条和下面的大卡各说了一遍，
          第一屏说三遍是这一页显得吵的主要原因之一。这里只说别处没有的：连击和今天的状态。 */}
      <div className="zoo-greet">
        <div className="zoo-greet-text">
          <p className="zoo-greet-hi">{greet}</p>
          <p className="zoo-greet-sub">{greetLine}</p>
        </div>
        {streak > 0 && (
          <div className="zoo-greet-streak" title={`连续学习 ${streak} 天`}>
            <Flame size={14} aria-hidden="true" /><b>{streakCount}</b>
          </div>
        )}
        <Sticker name={greetSticker(new Date().getHours(), total, done)} size={78} className="zoo-greet-mascot" />
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
              单词 <b>{Math.max(stats.modeCounts.mixed - stats.grammarRemaining - stats.kanjiCardRemaining - stats.confusionCardRemaining, 0)}</b>
              <i aria-hidden="true">·</i>
              语法 <b>{stats.grammarRemaining}</b>
              <i aria-hidden="true">·</i>
              汉字 <b>{stats.kanjiCardRemaining}</b>
              <i aria-hidden="true">·</i>
              辨析 <b>{stats.confusionCardRemaining}</b>
            </span>
          ) : isPlanMode && stats && stats.stage1NewTotal + stats.stage1ReviewTotal > 0 && (
            <span className="zoo-now-split">
              新词 <b>{stats.stage1NewDone}</b>/{stats.stage1NewTotal}
              <i aria-hidden="true">·</i>
              复习 <b>{stats.stage1ReviewDone}</b>/{stats.stage1ReviewTotal}
            </span>
          )}
          <MomentPop moment={moment} leaving={momentLeaving} />
          <Sticker name={heroSticker} size={96} className="zoo-now-mascot" />
          <span className="zoo-now-go">
            {heroPct !== null ? <span className="zoo-now-bar" aria-label={`今天完成 ${heroPct}%`}><i style={{ width: `${heroPct}%` }} /></span> : <span />}
            <span className="zoo-now-cta">{heroCta} →</span>
          </span>
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
                    <b>{mode.title}{mode.id === "mixed" && !entitlements.isPro && <span className="zoo-pro-tag">Pro</span>}</b>
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
              <small>{kanaGatePending() ? "先学五十音，完成后开始新词" : shortfallText(availableShortfall(jlpt.shortfall, entitlements.isPro))}</small>
            </button>
          )}
          <button className="zoo-duo-cell" onClick={() => onNavigate("team")}>
            <span className="zoo-duo-kick">组队</span>
            <b>和队友一起学</b>
            {/* 原来是 🙂🐿️🐼🐧 四个 emoji 排成一排，换成作者画的组队头图（和组队页头图同一张） */}
            <small className="zoo-duo-avatars">
              <Sticker name="scene-team" size={34} className="zoo-duo-team" />
              <em>创建、加入或邀请学习队伍</em>
            </small>
          </button>
        </div>
        {/* 每日量的圆环收在备考页里（用户定的「收纳到备考入口里」），主页只留上面那格入口。 */}
      </section>

      {/* ③ 学习工具 —— 一个盘子里的四格。去掉各自的描边和说明书副标题：
             「同音 · 自他 · 近义词对照」第一次有用，第一百次是噪音。 */}
      <section className="zoo-tray">
        <p className="zoo-tray-title">学习工具</p>
        <div className="zoo-quad">
          <button onClick={() => onNavigate("study-modes")}>
            <span aria-hidden="true"><Sticker name="icon-study-modes" size={36} /></span>
            <b>学习模式</b>
          </button>
          <button onClick={() => onNavigate("grammar-foundation")}>
            <span aria-hidden="true"><Sticker name="icon-grammar" size={36} /></span>
            <b>基础语法</b>
          </button>
          <button onClick={() => onOpenWordList()}>
            <span aria-hidden="true"><Sticker name="icon-vocab" size={36} /></span>
            <b>选词</b>
          </button>
          <button onClick={() => onNavigate("confusion")}>
            <span aria-hidden="true"><Sticker name="icon-practice" size={36} /></span>
            <b>疑难辨析</b>
          </button>
          <button onClick={() => onNavigate("kanji-readings")}>
            <span aria-hidden="true"><Sticker name="icon-kanji-readings" size={36} /></span>
            <b>一字多音</b>
          </button>
          <button onClick={() => onNavigate("favorites")}>
            <span aria-hidden="true"><Sticker name="icon-favorites" size={36} /></span>
            <b>收藏</b>
          </button>
          <button onClick={() => onNavigate("vocab-test")}>
            <span aria-hidden="true"><Sticker name="icon-stats" size={36} /></span>
            <b>查词汇量</b>
          </button>
          <button onClick={() => onNavigate("yuzu-shop")}>
            <span aria-hidden="true"><Sticker name="icon-shop" size={36} /></span>
            <b>柚子商店</b>
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
        </summary>
        <div className="zoo-maint-body">
          <button className="zoo-pop zoo-maint-btn" onClick={onRefreshOverview}>
            <b><RefreshCw size={13} aria-hidden="true" /> 刷新进度</b>
          </button>
          <button className="zoo-pop zoo-maint-btn" onClick={onMergeDuplicates}>
            <b><Merge size={13} aria-hidden="true" /> 合并重复词条</b>
          </button>
          <button className="zoo-pop zoo-maint-btn warn" onClick={onCompleteTodayWords}>
            <b><SkipForward size={13} aria-hidden="true" /> 一键完成今日单词</b>
          </button>
        </div>
      </details>
    </div>
  );
}
