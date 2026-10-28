import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { AppNavigationParams } from "../app/AppContext";
import { collectTeamRewards } from "../lib/team-activity";
import { CLOUD_AUTH_EVENT, CLOUD_SYNC_EVENT } from "../lib/sync-api";
import { REFERRAL_BANNER_KEY, REFERRAL_EVENT, referralBannerVisible } from "../lib/referral";
import { perfTime } from "../lib/perf-marks";
import { Capacitor } from "@capacitor/core";
// 图标统一走 lucide（ISC 协议，线性、单色、跟随 currentColor）。
import { Check, Merge, RefreshCw, SkipForward, SlidersHorizontal, Timer } from "lucide-react";
import { getWordStats, type ProgressOverview } from "../lib/api";
import { notifyProgressUpdated } from "../lib/progress-events";
import { useProgressUpdates } from "../lib/use-progress-updates";
import { todayWordAudioPlan, warmStage1SelectionCache } from "../lib/word-api";
import { prefetchWordPlanAudio } from "../lib/speech";
import { warmConfusionGroups } from "../lib/confusion-groups";
import { warmConfusionCandidateIndexes } from "../lib/models/confusion";
import { choosePostExamIntensity, getStudyPreferences, kanaGatePending, postExamChoice, postExamRecovery, PREFERENCES_EVENT, POST_EXAM_LIGHT_DAYS } from "../lib/studyPreferences";
import { scheduleSave } from "../lib/storage";
import { refreshTodayWordPlan } from "../lib/word-api";
import { refreshMixedCardTasks } from "../lib/mixed-cards";
import { answerLevelAdvance, levelAdvancePrompt, type LevelAdvancePrompt } from "../lib/level-advance";
import { getDatabase } from "../lib/database";
import { streakSnapshot } from "../lib/streak";
import { StreakFlame, flameStateOf } from "./streak/StreakFlame";
import { StreakCelebrationGate } from "./streak/StreakMoments";
import type { WordStats } from "../types/vocabulary";
import type { Page, StudyMode } from "../types/app";
import type { JLPTLevel } from "../types/grammar";
import { VISIBLE_STUDY_MODES, studyModeInfo } from "../lib/studyMode";
import { getJlptPlanStatus, type JlptPlanStatus } from "../lib/jlpt/status";
import { examLabel, parseExamDate, suggestedExamDate } from "../lib/jlpt/exam-dates";
import { getWeeklyReportNotice, WEEKLY_REPORT_UPDATED_EVENT } from "../lib/analytics/weekly-reports";
import { availableShortfall, shortfallText } from "../lib/jlpt/plan";
import { useEntitlements } from "../hooks/useEntitlements";
import { useCountUp } from "../hooks/useCountUp";
import { useMoments } from "../hooks/useMoments";
import { triggerRevealHaptic } from "../lib/haptics";
import { playStreakChirp } from "../lib/zoo-sounds";
import { Sticker, type StickerName } from "./CapybaraMascot";
import { Disclosure } from "./Disclosure";
import { MomentPop } from "./MomentPop";
import { WeeklyReportEntrance } from "./WeeklyReportEntrance";
import { ZooProgressPanel } from "./ZooProgressPanel";
import { StudyFocusIntro } from "./StudyFocusIntro";
import { useZoomOpen } from "./ZoomOpen";
import { pickCapyTools } from "./capy-tool-selection";
import { isStudyFocusArmed, setStudyFocusArmed } from "../lib/study-focus";
import { scrollPageToTop } from "../lib/touch-adapter";
import "./ZooHome.css";

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
  onNavigate: (page: Page, params?: AppNavigationParams) => void;
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

const staggerStyle = (index: number): CSSProperties | undefined =>
  index < 8 ? { "--i": index } as CSSProperties : undefined;

/**
 * 大卡那只吉祥物跟着「现在几点」换：早上伸懒腰、中午饿了、下午敲电脑、晚上戴耳机、深夜睡着；今天走完了换成欢呼。
 * 主页是一天打开次数最多的一屏，永远同一张等于没有表情。原来这套给问候行旁边的第二只用，大卡那只按进度换
 * （fired-up / book / cheer）；v3 一屏只留一只后，作者 10-14 定：留大卡、换成这套按时间的（「晚上有晚上的效果，饭点有饭点的效果」）。
 */
const nowSticker = (hour: number, total: number, done: number): StickerName =>
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
  const [referralBanner, setReferralBanner] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = () => {
      const version = ++revision;
      void referralBannerVisible().then((visible) => { if (active && version === revision) setReferralBanner(visible); });
    };
    const collect = () => { refresh(); void collectTeamRewards().catch(() => undefined); };
    collect();
    window.addEventListener(REFERRAL_EVENT, refresh);
    window.addEventListener(CLOUD_AUTH_EVENT, collect);
    window.addEventListener(CLOUD_SYNC_EVENT, collect);
    return () => {
      active = false;
      window.removeEventListener(REFERRAL_EVENT, refresh);
      window.removeEventListener(CLOUD_AUTH_EVENT, collect);
      window.removeEventListener(CLOUD_SYNC_EVENT, collect);
    };
  }, []);
  const entitlements = useEntitlements();
  const [stats, setStats] = useState<WordStats | null>(null);
  const [jlpt, setJlpt] = useState<JlptPlanStatus | null>(null);
  const [recovery, setRecovery] = useState<ReturnType<typeof postExamRecovery>>(null);
  const [recoveryChoice, setRecoveryChoice] = useState<"light" | "usual" | null>(null);
  const [advance, setAdvance] = useState<LevelAdvancePrompt | null>(null);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [focusArmed, setFocusArmed] = useState(isStudyFocusArmed);
  const [focusIntroOpen, setFocusIntroOpen] = useState(false);
  // 每日量在设置页也能改，所以跟着 PREFERENCES_EVENT 走，别只在挂载时读一次
  const [goals, setGoals] = useState(() => getStudyPreferences());
  // 更新日的新报告提示。只在这一份报告未读、且还在发布窗口内时为真。
  const [weeklyNotice, setWeeklyNotice] = useState<"new" | "read" | "expired" | "none">("none");
  const { moment, leaving: momentLeaving, collect: collectMoments } = useMoments();
  const refreshRef = useRef<() => void>(() => undefined);
  const [capyTools] = useState(pickCapyTools);
  const [pokedTool, setPokedTool] = useState<StickerName | null>(null);
  const [flameJumping, setFlameJumping] = useState(false);
  const { open, overlay } = useZoomOpen();

  useEffect(() => {
    const refreshWeeklyNotice = () => {
      try {
        setWeeklyNotice(perfTime("首页 · 周报提示", () => getWeeklyReportNotice().state));
      } catch {
        setWeeklyNotice("none");
      }
    };
    const refresh = () => {
      refreshWeeklyNotice();
      try {
        const next = perfTime("首页 · 词统计与排今日计划", () => getWordStats());
        setStats(next);
      } catch {
        // 词库还没加载好时先留空,进度事件会再触发一次
        return;
      }
      // 关掉备考计划的人不该在首页看到它,所以 enabled 为假时直接清空
      try {
        const plan = perfTime("首页 · 备考状态", () => getJlptPlanStatus());
        setJlpt(plan.enabled ? plan : null);
        const nextRecovery = plan.enabled ? postExamRecovery() : null;
        setRecovery(nextRecovery);
        setRecoveryChoice(nextRecovery ? postExamChoice(nextRecovery.key) : null);
      } catch {
        setJlpt(null);
        setRecovery(null);
      }
      try { setAdvance(levelAdvancePrompt()); } catch { setAdvance(null); }
      // 必须在 stats 读完之后:当天的计划是在那里面排好的,
      // 排之前问 plan_trend 会看到「今天 0 个」,报出一句假喜讯。
      perfTime("首页 · 小时刻", collectMoments);
    };
    refresh();
    refreshRef.current = refresh;
    const timer = window.setInterval(refreshWeeklyNotice, 60_000);
    window.addEventListener(WEEKLY_REPORT_UPDATED_EVENT, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(WEEKLY_REPORT_UPDATED_EVENT, refresh);
    };
  }, [collectMoments]);

  useEffect(() => {
    // 主页先完成首屏和统计渲染，空闲几秒后只构建只读缓存，再开始后台音频队列。
    const timer = window.setTimeout(() => {
      try {
        warmStage1SelectionCache();
        warmConfusionGroups();
        warmConfusionCandidateIndexes();
        prefetchWordPlanAudio(todayWordAudioPlan());
      } catch { /* 只预热缓存，失败不能影响学习 */ }
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, []);
  // 进度事件走 useProgressUpdates：小程序里主页挂在后台时，每答一题不再同步重算一遍（见那个 hook 的注释）
  useProgressUpdates(() => refreshRef.current());

  useEffect(() => {
    const sync = () => setGoals(getStudyPreferences());
    window.addEventListener(PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(PREFERENCES_EVENT, sync);
  }, []);

  const greet = greetingFor(new Date().getHours());
  const total = stats?.stage1ProgressTotal ?? 0;
  const done = stats?.stage1ProgressDone ?? 0;
  const remaining = Math.max(0, total - done);
  // streakSnapshot 扫全表：只在 stats 变了（答题 / 进度更新）时重算，不跟着每次渲染
  const streakSnap = useMemo(() => (stats ? perfTime("首页 · 连胜", streakSnapshot) : null), [stats]);
  const streak = streakSnap?.streak ?? 0;
  const streakCount = useCountUp(streak);
  const examDateMissing = Boolean(jlpt && !parseExamDate(goals.jlptExamDate) && !suggestedExamDate(jlpt.examKind));

  const chooseRecovery = (choice: "light" | "usual") => {
    if (!recovery) return;
    choosePostExamIntensity(recovery.key, choice);
    setRecoveryChoice(choice);
    if (choice === "usual") {
      refreshTodayWordPlan();
      refreshMixedCardTasks(getDatabase());
    }
    scheduleSave(0);
    notifyProgressUpdated();
  };
  const chooseAdvance = (choice: "up" | "back" | "pause") => {
    if (!advance) return;
    answerLevelAdvance(advance.kind, advance.level, choice);
    setAdvance(null);
    refreshTodayWordPlan();
    refreshMixedCardTasks(getDatabase());
    scheduleSave(0);
    notifyProgressUpdated();
  };
  const adjustRecoveryGoal = () => {
    if (recovery) chooseRecovery("light");
    onNavigate("jlpt-plan");
  };

  // 问候语只说**别处没说过的**：剩余量顶栏的进度条和大卡已经各写了一遍。
  // 这里给的是当天的状态和连击 —— 同一屏里同一个数字出现三次，是这页显吵的主因之一。
  const greetLine = !stats
    ? "正在读取…"
    : total === 0
      ? "今天还没排计划"
      : remaining === 0
        ? "今天学完了，歇会儿吧"
        : streakSnap?.atRisk
          ? `连续 ${streak} 天，今天还没点火`
          : streak > 0
          ? "今天也接着来" // 连续天数右边火苗那枚已经写着，这里不再说一遍
          : "今天的计划排好了";

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
  const heroSticker = nowSticker(new Date().getHours(), total, done);
  const heroSub = !stats
    ? "正在读取"
    : activeMode === "mistakes"
      ? `今天攻掉 ${stats.mistakes.answeredToday} 个`
      : isPlanMode
        ? (activeCount > 0 ? (done > 0 ? "今天还剩" : "今天要学") : `今天学了 ${done} 个`)
        : activeInfo.subtitle;
  const heroCta = activeCount > 0 ? (done > 0 ? "继续" : "开始") : isPlanMode ? "再来一批" : "去看看";

  const weeklyEntryEnabled = Capacitor.getPlatform() !== "wechat" && goals.weeklyReportEnabled;
  const toolItems: { title: string; icon: StickerName; action: () => void }[] = [
    // 2026-10-14 v3 §1.1b：「学习模式」页和大卡上的「学习方式」下拉是同一份清单，页删了，这一格改成回到顶上展开下拉
    { title: "学习模式", icon: "tool-modes", action: () => { scrollPageToTop(); setModeSheetOpen(true); } },
    { title: "基础语法", icon: "tool-grammar", action: () => onNavigate("grammar-foundation") },
    { title: "选词", icon: "tool-wordlist", action: () => onOpenWordList() },
    { title: "疑难辨析", icon: "tool-confusion", action: () => onNavigate("confusion") },
    { title: "开口练习", icon: "tool-talk", action: () => onNavigate("talk") },
    { title: "JLPT 刷题", icon: "tool-jlpt", action: () => onNavigate("jlpt-practice") },
    { title: "一字多音", icon: "tool-kanji-readings", action: () => onNavigate("kanji-readings") },
    { title: "收藏", icon: "tool-favorites", action: () => onNavigate("favorites") },
    { title: "查词汇量", icon: "tool-vocab-test", action: () => onNavigate("vocab-test") },
    { title: "柚子商店", icon: "tool-shop", action: () => onNavigate("yuzu-shop") }
  ];

  const openTool = (event: ReactMouseEvent<HTMLButtonElement>, item: typeof toolItems[number]) => {
    if (!capyTools.has(item.icon)) {
      item.action();
      return;
    }
    setPokedTool(item.icon);
    window.setTimeout(() => setPokedTool((current) => current === item.icon ? null : current), 320);
    if (goals.zooSounds) playStreakChirp();
    triggerRevealHaptic();
    open(event, item.action, `${item.icon}-capy` as StickerName);
  };

  const openTeam = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const go = () => onNavigate("team");
    if (!capyTools.has("tool-team")) {
      go();
      return;
    }
    setPokedTool("tool-team");
    window.setTimeout(() => setPokedTool((current) => current === "tool-team" ? null : current), 320);
    if (goals.zooSounds) playStreakChirp();
    triggerRevealHaptic();
    open(event, go, "tool-team-capy");
  };

  return (
    <div className={`zoo-page zoo-home-v2${weeklyEntryEnabled ? " has-weekly-cord" : ""}`}>
      {weeklyEntryEnabled && <WeeklyReportEntrance unread={weeklyNotice === "new"} onOpen={onOpenWeeklyReport} />}
      <StreakCelebrationGate />
      {/* 问候条。**不再重复「今天还有 N 个词」** —— 顶栏的进度条和下面的大卡各说了一遍，
          第一屏说三遍是这一页显得吵的主要原因之一。这里只说别处没有的：连击和今天的状态。 */}
      <div className="zoo-greet">
        <div className="zoo-greet-text">
          <p className="zoo-greet-hi">{greet}</p>
          <p className="zoo-greet-sub">{greetLine}</p>
        </div>
        {/* 2026-10-16 作者：火苗要更显眼。从 18px 小药丸放大成问候语右边一块（34px 火苗 + 26px 数字），没学灰、学完橙 */}
        {streak > 0 && (
          <button type="button" className={`zoo-greet-streak is-${flameStateOf(streakSnap?.todayStatus ?? "none")}`} title={`连续学习 ${streak} 天`} onClick={(event) => {
            setFlameJumping(true);
            window.setTimeout(() => setFlameJumping(false), 240);
            open(event, () => onNavigate("streak"));
          }}>
            <StreakFlame state={flameStateOf(streakSnap?.todayStatus ?? "none")} tier={streakSnap?.tier ?? 1} atRisk={streakSnap?.atRisk} size={34} className={flameJumping ? "zoo-flame-jump" : ""} /><b>{streakCount}</b><small>天</small>
          </button>
        )}
      </div>
      {referralBanner && <div className="zoo-referral-banner">
        <button onClick={() => onNavigate("invite", { referralCode: "", referralFocus: true })}>有邀请码？ <span aria-hidden="true">→</span></button>
        <button aria-label="不再显示邀请码提示" onClick={() => {
          try { localStorage.setItem(REFERRAL_BANNER_KEY, "1"); } catch { /* 本次仍关闭。 */ }
          setReferralBanner(false);
        }}>×</button>
      </div>}

      {recovery && !recoveryChoice && (
        <section className="zoo-post-exam" aria-label="考后提醒">
          <div className="zoo-post-exam-head">
            <span className="zoo-post-exam-badge">考完啦</span>
            <div><b>辛苦了，{recovery.target} 考试结束啦</b><p>要调整下一场的目标吗？</p></div>
          </div>
          <p>考后 {POST_EXAM_LIGHT_DAYS} 天先放轻松：暂停新学；每天最多复习单词 60、语法 10、汉字 10、辨析 5 条。原额度保留，期满自动恢复。</p>
          <div className="zoo-post-exam-actions">
            <button className="zoo-post-exam-primary" onClick={adjustRecoveryGoal}>调整目标</button>
            <button onClick={() => chooseRecovery("light")}>先按轻量计划</button>
            <button onClick={() => chooseRecovery("usual")}>保持原强度</button>
          </div>
        </section>
      )}

      {advance && !(recovery && !recoveryChoice) && (
        <section className="zoo-post-exam" aria-label={`${advance.kind === "words" ? "单词" : "语法"}进阶提醒`}>
          <div className="zoo-post-exam-head">
            <span className="zoo-post-exam-badge">{advance.level}</span>
            <div><b>{advance.level} {advance.kind === "words" ? "单词" : "语法"}{advance.again ? "已学完" : `已学 ${advance.percent}%`}</b><p>接下来想怎么学？</p></div>
          </div>
          <div className="zoo-post-exam-actions">
            <button className="zoo-post-exam-primary" onClick={() => chooseAdvance("up")}>继续学 {advance.next}</button>
            {advance.backfill && <button onClick={() => chooseAdvance("back")}>先补 {advance.backfill}</button>}
            <button onClick={() => chooseAdvance("pause")}>先不加{advance.kind === "words" ? "新词" : "新语法"}</button>
          </div>
        </section>
      )}

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
          <Sticker name={heroSticker} size={96} className="zoo-now-mascot" />
          <span className="zoo-now-go">
            {heroPct !== null ? <span className="zoo-now-bar" aria-label={`今天完成 ${heroPct}%`}><i style={{ width: `${heroPct}%` }} /></span> : <span />}
            <span className={`zoo-now-cta${activeCount > 0 ? " ds-nudge" : ""}`}>{heroCta} →</span>
          </span>
        </button>
        {/* 挂在大卡上沿外面：大卡本身 overflow:hidden（裁右上角的装饰圆），2026-10-16 前放在卡里面，上半截一直被裁掉 */}
        <MomentPop moment={moment} leaving={momentLeaving} />

        <div className="zoo-now-foot">
          <div className={`zoo-focus-toggle${focusArmed ? " on" : ""}`}>
            <button
              className="zoo-focus-check"
              type="button"
              role="checkbox"
              aria-label="启用倒计时学习"
              aria-checked={focusArmed}
              onClick={() => { setStudyFocusArmed(!focusArmed); setFocusArmed(!focusArmed); }}
            >
              <span className="zoo-focus-box" aria-hidden="true">{focusArmed && <Check size={11} strokeWidth={3.2} />}</span>
            </button>
            <button className="zoo-focus-label" type="button" onClick={() => setFocusIntroOpen(true)}>
              <Timer size={12} aria-hidden="true" /> 倒计时学习
            </button>
          </div>
          <button
            className="zoo-mode-chip"
            onClick={() => setModeSheetOpen((open) => !open)}
            aria-expanded={modeSheetOpen}
          >
            <SlidersHorizontal size={12} aria-hidden="true" /> 学习方式 · <b>{activeInfo.short}</b> {modeSheetOpen ? "▴" : "▾"}
          </button>
        </div>

        {focusIntroOpen && (
          <StudyFocusIntro
            onCancel={() => setFocusIntroOpen(false)}
            onConfirm={() => { setStudyFocusArmed(true); setFocusArmed(true); setFocusIntroOpen(false); }}
          />
        )}

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
                  <span className="zoo-modes-item-emoji" aria-hidden="true"><Sticker name={`mode-${mode.id}`} size={32} /></span>
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
        <div className="zoo-duo ds-stagger">
          {jlpt && (
            <button className="zoo-duo-cell zoo-duo-plan" onClick={() => onNavigate("jlpt-plan")} style={staggerStyle(0)}>
              <span className="zoo-duo-kick">{jlpt.examKind === "jlpt" ? `${jlpt.target} 备考` : examLabel(jlpt.examKind)}</span>
              <b>{examDateMissing ? "先选考试日期" : jlpt.finished ? "已考完" : `还有 ${jlpt.plan.daysLeft} 天`}</b>
              <small>{examDateMissing ? "选择日期后生成每日计划" : recovery ? recoveryChoice === "usual" ? "已恢复平时学习量，可设置新目标" : `考后轻量期还剩 ${recovery.daysLeft} 天` : jlpt.finished ? "可设置下一场目标" : kanaGatePending() ? "先学五十音，完成后开始新词" : shortfallText(availableShortfall(jlpt.shortfall, entitlements.isPro))}</small>
            </button>
          )}
          <button className="zoo-duo-cell" onClick={openTeam} style={staggerStyle(jlpt ? 1 : 0)}>
            <span className="zoo-duo-kick">组队</span>
            <b>和队友一起学</b>
            {/* 原来是 emoji 排成一排，后来换成一群水豚的组队头图；v3 一屏只留一只吉祥物（大卡上那只），这里换成三面队旗 */}
            <small className="zoo-duo-avatars">
              <Sticker name={capyTools.has("tool-team") ? "tool-team-capy" : "tool-team"} size={34} className={`zoo-duo-team${pokedTool === "tool-team" ? " zoo-tool-capy-poke" : ""}`} />
              <em>建队，或凭邀请码加入</em>
            </small>
          </button>
          <button className="zoo-duo-cell" onClick={() => onNavigate("invite", { referralCode: "", referralFocus: false })} style={staggerStyle(jlpt ? 2 : 1)}>
            <span className="zoo-duo-kick">邀请好友</span>
            <b>一起学日语</b>
            <small>我的邀请码 →</small>
          </button>
        </div>
        {/* 每日量的圆环收在备考页里（用户定的「收纳到备考入口里」），主页只留上面那格入口。 */}
      </section>

      {/* ③ 学习工具 —— 一个盘子里的四格。去掉各自的描边和说明书副标题：
             「同音 · 自他 · 近义词对照」第一次有用，第一百次是噪音。 */}
      <section className="zoo-tray">
        <p className="zoo-tray-title">学习工具</p>
        <div className="zoo-quad ds-stagger">
          {toolItems.map((item, index) => (
            <button key={item.title} onClick={(event) => openTool(event, item)} style={staggerStyle(index)}>
              <span className={`zoo-tool-icon${pokedTool === item.icon ? " zoo-tool-capy-poke" : ""}`} aria-hidden="true"><Sticker name={capyTools.has(item.icon) ? `${item.icon}-capy` as StickerName : item.icon} size={44} /></span>
              <b>{item.title}</b>
            </button>
          ))}
        </div>
      </section>

      {/* ④ 进度概览 —— 默认只给一行数，柱状图收进折叠里。
             十根柱子里七根是 0%，常驻 291px 去展示这个不划算。 */}
      <section className="zoo-tray">
        <Disclosure className="zoo-fold" weappSummaryClassName="zoo-fold-summary" summary={
          <>
            <span className="zoo-tray-title">进度概览</span>
            <small>
              单词 {overview.words.seen} · 掌握 {overview.words.completed} · 薄弱 {overview.words.low}
            </small>
          </>
        }>
          <ZooProgressPanel overview={overview} onOpenWordList={onOpenWordList} onOpenGrammar={onOpenGrammarLevel} />
        </Disclosure>
      </section>

      {/* ⑤ 进度维护:低频 + 有副作用,默认收起来 */}
      <Disclosure className="zoo-maint" weappSummaryClassName="zoo-maint-summary" summary="进度维护">
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
      </Disclosure>
      {overlay}
    </div>
  );
}
