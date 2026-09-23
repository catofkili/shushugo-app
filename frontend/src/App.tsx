import { lazy, ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { WordStudy } from "./pages/WordStudy";
import { CapybaraMascot, CapybaraWalk } from "./components/CapybaraMascot";
import { AppNavigation } from "./components/AppNavigation";
import { ZooHome } from "./components/ZooHome";
import { Paywall } from "./components/Paywall";
import { ProReadingPreview } from "./components/ProReadingPreview";
import { AuthDialog } from "./components/AuthDialog";
import { GrammarHighlightProvider } from "./components/GrammarHighlightProvider";
import { useStudyStore } from "./hooks/useStudyStore";
import { useEntitlements } from "./hooks/useEntitlements";
import { completeTodayWordPlan, getProgressOverview, recordStubbornQuickStudy, startPickedStudy as startPickedWordStudy, ProgressOverview } from "./lib/api";
import { canUseFeature, FeatureId, getEntitlements } from "./lib/entitlements";
import { PROGRESS_UPDATED_EVENT, notifyProgressUpdated } from "./lib/progress-events";
import { loadKanjiUnitIndex } from "./lib/kanji-unit-index";
import { activateMistakesForToday, defaultStudyMode, getStudyMode, saveStudyMode, STUDY_MODE_EVENT, studyModeInfo } from "./lib/studyMode";
import { studyDayEnd } from "./lib/database/db-utils";
import { getGrammarLevelPreference, saveGrammarLevelPreference, type GrammarLevelSelection } from "./lib/grammarPreferences";
import { CLOUD_AUTH_EVENT, CLOUD_SYNC_EVENT, getCloudSession, putCloudWeeklyReport, LEVEL_PLAN_TRIAL_EXPIRES_KEY, LEVEL_PLAN_TRIAL_NOTICE_KEY, type CloudSession, type CloudSyncEventDetail } from "./lib/sync-api";
import { syncUserProfileAfterLogin } from "./lib/profile-sync";
import { getPersistenceFailure, PERSISTENCE_ERROR_EVENT, PERSISTENCE_OK_EVENT, requestFullSnapshot, saveDatabase } from "./lib/storage";
import type { SearchResult } from "./lib/search-api";
import { GrammarMode, Page, StudyMode } from "./types/app";
import { JLPTLevel } from "./types/grammar";
import type { LibraryLevel } from "./lib/word-library";
import { AchievementsPage } from "./pages/AchievementsPage";
import { YuzuShopPage } from "./pages/YuzuShopPage";
import { ACHIEVEMENT_UNLOCKED_EVENT } from "./lib/userProfile";
import { playStreakChirp } from "./lib/zoo-sounds";
import { triggerAchievementHaptic } from "./lib/haptics";
import { generateLatestWeeklyReport } from "./lib/analytics/weekly-reports";
import { recordWeeklyReportEvent, type WeeklyReportEntry } from "./lib/analytics/weekly-report-events";
import { getStudyPreferences, PREFERENCES_EVENT } from "./lib/studyPreferences";
import { consumePendingWeeklyReportWeekStart, loadReminderSettings, syncWeeklyReportNotification, WEEKLY_REPORT_NOTIFICATION_EVENT } from "./lib/notifications";
import { OPEN_GRAMMAR_FOUNDATION_EVENT } from "./lib/grammar-foundation-navigation";
import type { QuizScope } from "./lib/distinction-quiz";
import { LevelSetup } from "./components/LevelSetup";
import { shouldShowLevelSetup } from "./lib/level-plan";

const Library = lazy(() => import("./pages/Library").then((module) => ({ default: module.Library })));
const GrammarFoundationPage = lazy(() => import("./pages/GrammarFoundationPage").then((module) => ({ default: module.GrammarFoundationPage })));
const GrammarDetail = lazy(() => import("./pages/GrammarDetail").then((module) => ({ default: module.GrammarDetail })));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage").then((module) => ({ default: module.FavoritesPage })));
const ConfusionPage = lazy(() => import("./pages/ConfusionPage").then((module) => ({ default: module.ConfusionPage })));
const DistinctionQuizPage = lazy(() => import("./pages/DistinctionQuizPage").then((module) => ({ default: module.DistinctionQuizPage })));
const KanjiReadingUsagePage = lazy(() => import("./pages/KanjiReadingUsagePage").then((module) => ({ default: module.KanjiReadingUsagePage })));
const ImmersiveGrammar = lazy(() => import("./pages/ImmersiveGrammar").then((module) => ({ default: module.ImmersiveGrammar })));
const GrammarQuiz = lazy(() => import("./pages/GrammarQuiz").then((module) => ({ default: module.GrammarQuiz })));
const PersonalInfo = lazy(() => import("./pages/PersonalInfo").then((module) => ({ default: module.PersonalInfo })));
const AccountSecurity = lazy(() => import("./pages/AccountSecurity").then((module) => ({ default: module.AccountSecurity })));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings").then((module) => ({ default: module.NotificationSettings })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const JlptPlanPage = lazy(() => import("./pages/JlptPlanPage").then((module) => ({ default: module.JlptPlanPage })));
const PrivacySettings = lazy(() => import("./pages/PrivacySettings").then((module) => ({ default: module.PrivacySettings })));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy").then((module) => ({ default: module.PrivacyPolicy })));
const UserAgreement = lazy(() => import("./pages/UserAgreement").then((module) => ({ default: module.UserAgreement })));
const HelpPage = lazy(() => import("./pages/HelpPage").then((module) => ({ default: module.HelpPage })));
const AboutPage = lazy(() => import("./pages/AboutPage").then((module) => ({ default: module.AboutPage })));
const ProPage = lazy(() => import("./pages/ProPage").then((module) => ({ default: module.ProPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const StudyModesPage = lazy(() => import("./pages/StudyModesPage").then((module) => ({ default: module.StudyModesPage })));
const TeamPage = lazy(() => import("./pages/TeamPage").then((module) => ({ default: module.TeamPage })));
const QuickStudyPage = lazy(() => import("./pages/QuickStudyPage").then((module) => ({ default: module.QuickStudyPage })));
const VocabTestPage = lazy(() => import("./pages/VocabTestPage").then((module) => ({ default: module.VocabTestPage })));
const WordLibraryPage = lazy(() => import("./pages/WordLibraryPage").then((module) => ({ default: module.WordLibraryPage })));
const WeeklyReportPage = lazy(() => import("./pages/WeeklyReportPage").then((module) => ({ default: module.WeeklyReportPage })));

const PageLoading = () => (
  <div className="grid min-h-[50vh] place-items-center p-6 text-sm font-semibold text-white/55" aria-busy="true">
    <div className="text-center"><CapybaraWalk size={72} className="mx-auto mb-3" />正在加载…</div>
  </div>
);

const toolPageTitles: Partial<Record<Page, string>> = {
  "study-modes": "学习模式",
  "grammar-foundation": "基础语法",
  favorites: "收藏",
  confusion: "疑难辨析",
  "distinction-quiz": "辨析练习",
  "kanji-readings": "一字多音",
  "word-list": "选词",
  "quick-study": "快速学习",
  "vocab-test": "查词汇量",
  "yuzu-shop": "柚子商店"
};

const accountProtectedPages = new Set<Page>(["account", "personal-info", "team"]);
/** 练习型 Pro 页面仍直接拦截；浏览型页面在页内给固定的对角线预览。 */
const proPages: Partial<Record<Page, FeatureId>> = {
  "distinction-quiz": "confusionGroups"
};

const proReadingPages: Partial<Record<Page, FeatureId>> = {
  confusion: "confusionGroups",
  "kanji-readings": "kanjiReadingUsage"
};

/** 一枚成就在屏幕上停多久。连着补发五六个时,总长度也要还在「一小串」的量级里。 */
const ACHIEVEMENT_POP_HOLD_MS = 1700;
/** 退场动画时长,和 .zoo-achv-pop.leaving 对齐 */
const ACHIEVEMENT_POP_OUT_MS = 260;

export default function App() {
  const store = useStudyStore();
  const entitlements = useEntitlements();
  const [page, setPage] = useState<Page>("home");
  const [pageHistory, setPageHistory] = useState<Page[]>([]); // 页面历史栈
  const [grammarMode, setGrammarMode] = useState<GrammarMode>("learn");
  const [selectedGrammarId, setSelectedGrammarId] = useState("wa");
  const [selectedFoundationRuleId, setSelectedFoundationRuleId] = useState<string | null>(null);
  const [selectedGrammarLevel, setSelectedGrammarLevelState] = useState<GrammarLevelSelection>(getGrammarLevelPreference);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notice, setNotice] = useState("");
  const [overview, setOverview] = useState<ProgressOverview>(() => getProgressOverview());
  // "general" = 用户主动来买(Pro 页的「选择方案」),不是撞上某个被锁的功能。
  // Paywall 里本来就写了一份不指名功能的通用文案,但入口一直是 `{paywallFeature && …}`,
  // 不给 feature 就干脆不渲染 —— 那份文案从写下来起没有一条路走得到,
  // 于是 Pro 页只能借一个「完整 JLPT 规划」的名头把弹层叫出来,而那功能根本没上锁。
  const [paywallTarget, setPaywallTarget] = useState<FeatureId | "general" | undefined>();
  const readingPreviewFeature = proReadingPages[page]
    ?? (page === "grammar" && grammarMode === "immersive" ? "immersiveGrammar" : undefined);
  const readingPreviewLocked = Boolean(readingPreviewFeature && !canUseFeature(readingPreviewFeature, entitlements));
  // 词库页的预设等级：进度概览点 N5 那根柱子进来时带着它
  const [wordListLevel, setWordListLevel] = useState<LibraryLevel>("all");
  /** 完成页交给快速学习的那批顽固词；null = 正常的今日快速学习。 */
  const [stubbornQuickIds, setStubbornQuickIds] = useState<number[] | null>(null);
  const [distinctionQuizScope, setDistinctionQuizScope] = useState<QuizScope>({ kind: "learned" });
  const [selectedStudyMode, setSelectedStudyMode] = useState<StudyMode>(() => getStudyMode() || defaultStudyMode);
  const [launchStudyMode, setLaunchStudyMode] = useState<StudyMode>(() => getStudyMode() || defaultStudyMode);
  const [wordStudyRevision, setWordStudyRevision] = useState(0);
  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false });
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingAccountPage, setPendingAccountPage] = useState<Page | null>(null);
  const [weeklyReportStart, setWeeklyReportStart] = useState<string | null>(null);
  const [weeklyReportEntry, setWeeklyReportEntry] = useState<WeeklyReportEntry>("button");
  const [levelSetupOpen, setLevelSetupOpen] = useState(() => {
    try { return shouldShowLevelSetup(); } catch { return false; }
  });
  const [trialEndedOpen, setTrialEndedOpen] = useState(false);
  // 发布期开关：关掉之后入口、提醒、通知和云归档一起停，历史照旧可读。
  const [weeklyReportEnabled, setWeeklyReportEnabled] = useState(
    () => getStudyPreferences().weeklyReportEnabled
  );
  const savedWeeklyReportStartRef = useRef<string | null>(null);
  const uploadedWeeklyReportStartRef = useRef<string | null>(null);
  const weeklyNotificationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!readingPreviewLocked) return;
    document.querySelector<HTMLElement>("main.app-landscape-main")?.scrollTo({ top: 0 });
  }, [page, readingPreviewLocked]);

  useEffect(() => {
    let alive = true;
    void getCloudSession().then((session) => {
      if (alive) setCloudSession(session);
    });
    const refreshAuth = (event: Event) => {
      const session = (event as CustomEvent<CloudSession>).detail;
      if (session) {
        uploadedWeeklyReportStartRef.current = null;
        setCloudSession(session);
      }
    };
    window.addEventListener(CLOUD_AUTH_EVENT, refreshAuth);
    return () => {
      alive = false;
      window.removeEventListener(CLOUD_AUTH_EVENT, refreshAuth);
    };
  }, []);

  useEffect(() => {
    const expiresAt = localStorage.getItem(LEVEL_PLAN_TRIAL_EXPIRES_KEY);
    if (!expiresAt || localStorage.getItem(LEVEL_PLAN_TRIAL_NOTICE_KEY) === expiresAt) return;
    let timer: number;
    const checkExpiry = () => {
      const remaining = Date.parse(expiresAt) - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(checkExpiry, Math.min(remaining + 100, 2_000_000_000));
        return;
      }
      const current = getEntitlements();
      if (current.isPro && current.source !== "trial") return;
      saveStudyMode("classic");
      setTrialEndedOpen(true);
    };
    timer = window.setTimeout(checkExpiry, 0);
    return () => window.clearTimeout(timer);
  }, [entitlements.isPro, entitlements.source]);

  useEffect(() => {
    const sync = () => {
      const enabled = getStudyPreferences().weeklyReportEnabled;
      setWeeklyReportEnabled((current) => {
        // 现场关掉时把已排期的周报通知一起撤掉，别让用户关了还收到提醒。
        if (current && !enabled) {
          void loadReminderSettings()
            .then((settings) => syncWeeklyReportNotification({ ...settings, weeklyReportReminder: false }))
            .catch(() => undefined);
        }
        return enabled;
      });
    };
    window.addEventListener(PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(PREFERENCES_EVENT, sync);
  }, []);

  // 每日量面板上也能换模式，那边写完 localStorage 只发一个事件，这里把 state 对上
  useEffect(() => {
    const sync = () => setSelectedStudyMode(getStudyMode() || defaultStudyMode);
    window.addEventListener(STUDY_MODE_EVENT, sync);
    return () => window.removeEventListener(STUDY_MODE_EVENT, sync);
  }, []);

  // 周日 14:00 之后第一次进入 App 时生成最近完整周期。生成是幂等的，
  // 不会在重渲染或切页时重新抽关键词；没有任何学习内容就保持安静。
  useEffect(() => {
    if (!weeklyReportEnabled) return undefined;
    const syncLatestReport = () => {
      try {
        const snapshot = generateLatestWeeklyReport("local");
        if (snapshot && savedWeeklyReportStartRef.current !== snapshot.report.window.start) {
          savedWeeklyReportStartRef.current = snapshot.report.window.start;
          recordWeeklyReportEvent({
            kind: "available",
            weekStart: snapshot.report.window.start,
            at: Date.now()
          });
          // 生成后立即请求一次完整本地快照，避免仍在内存中的周报因退出而丢失；
          // 后续普通保存和账号云同步也会按 weekly_reports 的行级时间戳增量处理。
          requestFullSnapshot();
          void saveDatabase().catch((error) => console.warn("Weekly report save skipped:", error));
        }
        if (snapshot && entitlements.isPro && uploadedWeeklyReportStartRef.current !== snapshot.report.window.start) {
          void putCloudWeeklyReport(snapshot.report.window.start, snapshot.report)
            .then(() => { uploadedWeeklyReportStartRef.current = snapshot.report.window.start; })
            .catch((error) => console.warn("Weekly report cloud archive skipped:", error));
        }
        const now = new Date();
        const notificationKey = `${now.toISOString().slice(0, 10)}:${snapshot?.report.window.start ?? "none"}`;
        if (typeof loadReminderSettings === "function" && weeklyNotificationKeyRef.current !== notificationKey) {
          void loadReminderSettings()
            .then((settings) => syncWeeklyReportNotification(settings, false, now))
            .then((result) => {
              if (!result.retryWeeklyReportSoon) weeklyNotificationKeyRef.current = notificationKey;
            })
            .catch((error) => console.warn("Weekly report notification skipped:", error));
        }
      } catch (error) {
        console.warn("Weekly report generation skipped:", error);
      }
    };
    syncLatestReport();
    // App 一直开着时也要在周日 14:00 后生成，不要求用户重启 App。
    const timer = window.setInterval(syncLatestReport, 60_000);
    return () => window.clearInterval(timer);
  }, [entitlements.isPro, cloudSession.email, weeklyReportEnabled]);

  // 这份总览只有首页在读(动物园地图/图鉴 2026-09-16 删了),而它是两条全库 words⋈progress 扫描
  // (实测 35ms)。以前它挂在 PROGRESS_UPDATED 上无条件重算 —— 于是**在学习页里
  // 每答一张卡都要重算一次谁也看不见的东西**。
  // 现在看不见就只记一个脏标记,等真回到要用它的页面再补算。
  const overviewVisible = page === "home";
  const overviewDirtyRef = useRef(false);
  useEffect(() => {
    const refresh = () => {
      if (!overviewVisible) {
        overviewDirtyRef.current = true;
        return;
      }
      overviewDirtyRef.current = false;
      setOverview(getProgressOverview());
    };
    if (overviewVisible && overviewDirtyRef.current) refresh();
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
  }, [overviewVisible]);

  // 字音单位索引是动态 import 的(399 KB 单独成 chunk)。首页的汉字模式计数要读它,
  // 所以开机就预热。
  //
  // 到位后**必须广播 PROGRESS_UPDATED_EVENT**,不能只 setOverview:ZooHome 有自己
  // 那份 getWordStats(),只在挂载时读一次、之后只听这个事件。光更新 App 的 state
  // 的话,首页会永远停在「索引还没加载完」那一刻读到的 0 —— 卡片上写着「暂无题」。
  useEffect(() => {
    let alive = true;
    void loadKanjiUnitIndex().then(() => {
      if (!alive) return;
      setOverview(getProgressOverview());
      notifyProgressUpdated();
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // 模式的自动恢复跟单词一样以凌晨 4 点为边界。若正在背一张卡，不在
    // 半途改 initialMode；离开学习页时 navigateToPage 会读取恢复后的模式。
    if (page === "word") return;
    const syncEffectiveMode = () => {
      const currentMode = getStudyMode();
      setSelectedStudyMode(currentMode);
      setLaunchStudyMode(currentMode);
    };
    const delay = Math.max(studyDayEnd().getTime() - Date.now() + 250, 250);
    const timer = window.setTimeout(syncEffectiveMode, delay);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") syncEffectiveMode();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [page]);

  const noticeTimerRef = useRef<number | undefined>(undefined);
  const syncConflictNoticeRef = useRef("");

  /**
   * 成就解锁。
   *
   * 判据是现算的、以前达成过的会自动补发,所以「一次解锁好几个」是常态而不是
   * 边缘情况 —— 而 checkAchievements 是在一个 forEach 里同步连发事件的。
   * 改版前每条都走 showNotice,它每次 clearTimeout + 覆盖 message,结果是
   * **补发三个只看得见最后一个**,而且和「已同步勾选范围」共用同一个青色小条。
   *
   * 现在排队一条一条播,有自己的形制(.zoo-achv-pop)、声音和触觉。
   */
  const achievementQueueRef = useRef<{ emoji: string; name: string }[]>([]);
  const [achievementPop, setAchievementPop] = useState<
    { item: { emoji: string; name: string }; rest: number; leaving: boolean } | null
  >(null);

  useEffect(() => {
    let playing = false;
    let timer: number | undefined;

    const step = () => {
      const next = achievementQueueRef.current.shift();
      if (!next) {
        playing = false;
        setAchievementPop(null);
        return;
      }
      setAchievementPop({ item: next, rest: achievementQueueRef.current.length, leaving: false });
      playStreakChirp();
      triggerAchievementHaptic();
      timer = window.setTimeout(() => {
        setAchievementPop((current) => (current ? { ...current, leaving: true } : current));
        timer = window.setTimeout(step, ACHIEVEMENT_POP_OUT_MS);
      }, ACHIEVEMENT_POP_HOLD_MS);
    };

    const onUnlock = (event: Event) => {
      const achievement = (event as CustomEvent<{ emoji: string; name: string }>).detail;
      if (!achievement) return;
      achievementQueueRef.current.push({ emoji: achievement.emoji, name: achievement.name });
      if (playing) return;
      playing = true;
      // 刻意延一拍再开播:同一批解锁是同步连发的,等这一轮 dispatch 全落进队列,
      // 第一条才数得出「后面还压着几个」。
      timer = window.setTimeout(step, 0);
    };

    window.addEventListener(ACHIEVEMENT_UNLOCKED_EVENT, onUnlock);
    return () => {
      window.removeEventListener(ACHIEVEMENT_UNLOCKED_EVENT, onUnlock);
      window.clearTimeout(timer);
    };
  }, []);

  const showNotice = (message: string, timeout = 1800) => {
    // 清掉上一条通知的计时器,避免旧计时器提前关掉新通知。
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), timeout);
  };

  useEffect(() => {
    const handleCloudSync = (event: Event) => {
      const detail = (event as CustomEvent<CloudSyncEventDetail>).detail;
      if (!detail) return;
      if (detail.status === "downloaded") {
        syncConflictNoticeRef.current = "";
        uploadedWeeklyReportStartRef.current = null;
        setOverview(getProgressOverview());
        try { generateLatestWeeklyReport("local", new Date(), true); requestFullSnapshot(); void saveDatabase().catch(() => undefined); } catch { /* 周报刷新不阻断同步 */ }
        // 背单词时不能因为后台同步重挂载 WordStudy,否则当前卡会被重新抽取。
        // 当前学习会话继续使用本地状态,答完后自然会读到最新数据库。
      } else if (detail.status === "merged") {
        syncConflictNoticeRef.current = "";
        uploadedWeeklyReportStartRef.current = null;
        setOverview(getProgressOverview());
        try { generateLatestWeeklyReport("local", new Date(), true); requestFullSnapshot(); void saveDatabase().catch(() => undefined); } catch { /* 周报刷新不阻断同步 */ }
      } else if (detail.status === "uploaded") {
        syncConflictNoticeRef.current = "";
      } else if (detail.status === "conflict" || detail.status === "signed-out") {
        const message = detail.message ?? "两台设备都有新进度，请到设置中手动处理。";
        if (syncConflictNoticeRef.current === message) return;
        syncConflictNoticeRef.current = message;
        window.clearTimeout(noticeTimerRef.current);
        setNotice(message);
        noticeTimerRef.current = window.setTimeout(() => setNotice(""), 5000);
      }
    };
    window.addEventListener(CLOUD_SYNC_EVENT, handleCloudSync);
    return () => window.removeEventListener(CLOUD_SYNC_EVENT, handleCloudSync);
  }, []);

  // 导航到新页面，记录历史。
  // studyModeOverride 给明确指定模式的入口用；其余入口读取当前有效模式，
  // 其中也包括「今日任务完成后、4 点前」的临时错题本。
  const navigateToPage = useCallback((newPage: Page, studyModeOverride?: StudyMode) => {
    // 「快速复习今天的顽固词」是一次性名单：从别处进快速学习就得回到今天那份，
    // 否则点一次顽固复习之后，首页的快速学习入口会一直停在那批词上。
    if (newPage === "quick-study") setStubbornQuickIds(null);
    if (accountProtectedPages.has(newPage) && !cloudSession.token) {
      setPendingAccountPage(newPage);
      setAuthOpen(true);
      return;
    }
    const proFeature = proPages[newPage];
    if (proFeature && !canUseFeature(proFeature, entitlements)) {
      setPaywallTarget(proFeature);
      return;
    }
    if (newPage === "word") {
      const currentMode = studyModeOverride ?? getStudyMode() ?? defaultStudyMode;
      // 混合学习是 Pro。主页 chip、模式页、上次存的模式三条路都从这里进学习页，
      // 拦在这一处就够；存的模式退回经典，免得下次启动又撞一次付费墙。
      if (currentMode === "mixed" && !canUseFeature("mixedStudy", entitlements)) {
        saveStudyMode(defaultStudyMode);
        setSelectedStudyMode(defaultStudyMode);
        setPaywallTarget("mixedStudy");
        return;
      }
      setSelectedStudyMode(currentMode);
      setLaunchStudyMode(currentMode);
      setWordStudyRevision((revision) => revision + 1);
    }
    if (newPage === "home" || newPage === "study-modes") {
      const currentMode = getStudyMode();
      setSelectedStudyMode(currentMode);
      setLaunchStudyMode(currentMode);
    }
    if (newPage === "home" || newPage === "profile") {
      setSelectedGrammarId("wa");
    }
    if (newPage === "grammar-foundation") setSelectedFoundationRuleId(null);
    if (newPage !== page) {
      setPageHistory((history) => [...history, page]);
      setPage(newPage);
    }
  }, [cloudSession.token, entitlements, page]);

  useEffect(() => {
    const openFoundationRule = (event: Event) => {
      const ruleId = (event as CustomEvent<{ ruleId?: string }>).detail?.ruleId;
      navigateToPage("grammar-foundation");
      setSelectedFoundationRuleId(ruleId ?? null);
    };
    window.addEventListener(OPEN_GRAMMAR_FOUNDATION_EVENT, openFoundationRule);
    return () => window.removeEventListener(OPEN_GRAMMAR_FOUNDATION_EVENT, openFoundationRule);
  }, [navigateToPage]);

  /** 主页入口：按钮和顶部下拉都走这里，只为了区分观测里的来源。 */
  const openWeeklyReportFrom = (entry: WeeklyReportEntry) => {
    setWeeklyReportEntry(entry);
    setWeeklyReportStart(null);
    navigateToPage("weekly-report");
  };

  useEffect(() => {
    const openWeeklyReport = (weekStart: string | null) => {
      setWeeklyReportStart(weekStart);
      setWeeklyReportEntry("notification");
      navigateToPage("weekly-report");
    };
    const handleNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ weekStart?: string | null }>).detail;
      openWeeklyReport(detail?.weekStart ?? null);
    };
    window.addEventListener(WEEKLY_REPORT_NOTIFICATION_EVENT, handleNotification);
    const pending = consumePendingWeeklyReportWeekStart();
    if (pending) openWeeklyReport(pending);
    return () => window.removeEventListener(WEEKLY_REPORT_NOTIFICATION_EVENT, handleNotification);
  }, [navigateToPage]);

  /**
   * 合并老库里重复录入的词条。**不可逆**（删的是词条行），所以先算清楚给用户看，
   * 确认之后先存整库恢复点再动手 —— 和 ビル 那次迁移一个规矩。
   */
  const mergeDuplicates = async () => {
    const { duplicateMergePlan, mergeDuplicateWords } = await import("./lib/duplicate-merge");
    const plan = duplicateMergePlan();
    if (!plan.pairs.length) {
      showNotice("没有找到重复录入的词条。", 2600);
      return;
    }
    const confirmed = window.confirm(
      `发现 ${plan.pairs.length} 行重复录入的词条（其中 ${plan.bothStudied} 组你两边都学过）。\n\n`
      + `合并会把这些行上的 ${plan.reviews} 条作答记录搬到保留的那行上，然后删掉重复行。\n`
      + "学习记录一条都不会丢，但删行不可逆。合并前会自动存一份整库恢复点。\n\n继续吗？"
    );
    if (!confirmed) return;
    try {
      const { saveRecoverySnapshot } = await import("./lib/storage");
      await saveRecoverySnapshot("before-duplicate-merge");
      const report = mergeDuplicateWords();
      refreshOverview();
      showNotice(
        `已合并 ${report.merged} 行重复词条，搬走 ${report.movedReviews} 条作答；`
        + `作答总数 ${report.reviewsBefore} → ${report.reviewsAfter}，一条没丢。`,
        6000
      );
    } catch (error) {
      console.error("[merge] 合并重复词条失败", error);
      showNotice("合并失败，数据没有改动。", 4000);
    }
  };

  const openWordList = (level?: string) => {
    const known: LibraryLevel[] = ["N5", "N4", "N3", "N2", "N1"];
    setWordListLevel(known.includes(level as LibraryLevel) ? (level as LibraryLevel) : "all");
    navigateToPage("word-list");
  };

  // 词库勾一批词 → 直接开一场只含这些词的学习。不写「上次用的模式」:
  // 清单是「这一次想突击这些」,不是长期偏好(saveStudyMode 对 transient 模式也会拒绝)。
  const startPickedStudy = (ids: number[]) => {
    if (!ids.length) return;
    const { session } = startPickedWordStudy(ids);
    // 勾的全是标了熟知的词时一张都出不来 —— 直接进去只会看到一个「过完了」,
    // 那不是完成,是根本没开始。
    if (!session.card) {
      showNotice("这些词都标了熟知，先「放回复习」再学。", 3000);
      return;
    }
    navigateToPage("word", "picked");
  };

  const openGrammarLevel = (level: JLPTLevel) => {
    setSelectedGrammarLevel(level);
    navigateToPage("grammar");
  };

  const requireAccount = (target?: Page) => {
    if (cloudSession.token) {
      if (target) navigateToPage(target);
      return;
    }
    setPendingAccountPage(target ?? null);
    setAuthOpen(true);
  };

  const handleAuthenticated = async (session: CloudSession) => {
    setCloudSession(session);
    try {
      await syncUserProfileAfterLogin(session);
    } catch {
      showNotice("账号已登录；个人资料将在恢复联网后继续同步。", 3200);
    }
    if (pendingAccountPage) {
      const target = pendingAccountPage;
      setPendingAccountPage(null);
      if (target !== page) {
        setPageHistory((history) => [...history, page]);
        setPage(target);
      }
    }
  };

  // 返回上一页
  const goBack = () => {
    if (pageHistory.length > 0) {
      const previousPage = pageHistory[pageHistory.length - 1];
      setPageHistory(pageHistory.slice(0, -1));
      setPage(previousPage);
    } else {
      setPage("home");
    }
  };



  /** 完成页：今天顽固词太多时不给加餐，改成把这批词丢进快速学习过一遍。 */
  const startStubbornQuickStudy = (wordIds: number[]) => {
    if (!wordIds.length) return;
    // 和加餐记同一笔账：见 recordStubbornQuickStudy 的注释。
    recordStubbornQuickStudy(wordIds.length);
    setStubbornQuickIds(wordIds);
    setPage("quick-study");
  };

  const startDistinctionQuiz = (scope: QuizScope) => {
    setDistinctionQuizScope(scope);
    navigateToPage("distinction-quiz");
  };

  const startWeeklyReview = (wordIds: number[]) => {
    if (!wordIds.length) return;
    setStubbornQuickIds(wordIds);
    setPageHistory((history) => [...history, page]);
    setPage("quick-study");
  };

  const openGrammar = (id: string) => {
    setSelectedGrammarId(id);
    navigateToPage("detail");
  };

  const openGrammarTab = (mode: GrammarMode = "learn") => {
    setGrammarMode(mode);
    if (mode === "learn") {
      setSelectedGrammarId("wa");
    }
    navigateToPage("grammar");
  };

  const setSelectedGrammarLevel = (value: GrammarLevelSelection) => {
    setSelectedGrammarLevelState(saveGrammarLevelPreference(value));
  };

  const markLearnedWithNotice = (id: string) => {
    store.markLearned(id);
    setOverview(getProgressOverview());
    showNotice("已标记为掌握，并保存到本地进度。");
  };

  const markForgotWithNotice = (id: string) => {
    store.recordReview(id, false);
    showNotice("已固定到前面，稍后继续看。");
  };

  const refreshOverview = () => setOverview(getProgressOverview());

  const completeTodayWords = () => {
    const confirmed = window.confirm("确定要把今天的单词任务直接标记为完成吗？这会记录为今日已完成并进入完成页。");
    if (!confirmed) return;
    try {
      const result = completeTodayWordPlan();
      setWordStudyRevision((revision) => revision + 1);
      setOverview(getProgressOverview());
      showNotice(result.completedCount ? `已完成今日 ${result.completedCount} 个单词任务。` : "今日单词任务已处于完成状态。", 2200);
      navigateToPage("word");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "一键完成失败。", 2600);
    }
  };

  const handleSearchResult = (result: SearchResult) => {
    if (result.type === "grammar") {
      openGrammar(result.id);
      return;
    }
    navigateToPage("word");
    showNotice(`已找到单词：${result.title}`, 2200);
  };

  const startStudyMode = (mode: StudyMode) => {
    const safeMode = saveStudyMode(mode || defaultStudyMode);
    setSelectedStudyMode(safeMode);
    setLaunchStudyMode(safeMode);
    // 快速复习自己有一页,不走单词学习页
    const ownPage = studyModeInfo(safeMode).page;
    if (ownPage) {
      navigateToPage(ownPage);
      return;
    }
    // 模式必须透传:navigateToPage 进单词页时会用 getStudyMode() 兜底,
    // 不传的话刚选的模式会被读回来的旧值覆盖(选 A 出 B)。
    navigateToPage("word", safeMode);
  };

  const startCurrentStudyMode = () => {
    // 首页大按钮启动的是「当前有效模式」。自动错题本不能走 saveStudyMode，
    // 否则会被误存成永久选择，第二天 4 点也恢复不回去。
    const currentMode = getStudyMode();
    setSelectedStudyMode(currentMode);
    setLaunchStudyMode(currentMode);
    const ownPage = studyModeInfo(currentMode).page;
    navigateToPage(ownPage ?? "word", currentMode);
  };

  const handleDailyModeComplete = (mode: StudyMode) => {
    const effectiveMode = activateMistakesForToday(mode);
    // 只更新选择态，不改变正在显示的 WordStudy initialMode，保留完成页。
    setSelectedStudyMode(effectiveMode);
  };

  const renderGrammarPage = () => (
    <GrammarHighlightProvider>
      <div>
        {grammarMode === "quiz" ? (
          <GrammarQuiz
            initialLevel={selectedGrammarLevel === "All" ? null : selectedGrammarLevel}
            onBack={() => openGrammarTab("learn")}
          />
        ) : grammarMode === "immersive" ? (
          canUseFeature("immersiveGrammar", entitlements) ? (
            <ImmersiveGrammar
              key={selectedGrammarLevel}
              selectedLevel={selectedGrammarLevel}
              onBack={() => openGrammarTab("learn")}
              onOpenFavorites={() => navigateToPage("favorites")}
              onMarkLearned={markLearnedWithNotice}
            />
          ) : (
            <ProReadingPreview title="沉浸式语法" onUpgrade={() => setPaywallTarget("immersiveGrammar")}>
              <ImmersiveGrammar
                key={selectedGrammarLevel}
                selectedLevel={selectedGrammarLevel}
                onBack={() => openGrammarTab("learn")}
                onOpenFavorites={() => navigateToPage("favorites")}
                onMarkLearned={markLearnedWithNotice}
              />
            </ProReadingPreview>
          )
        ) : (
          <Library
            getMastery={store.getMastery}
            onMarkLearned={markLearnedWithNotice}
            onMarkForgot={markForgotWithNotice}
            selectedLevel={selectedGrammarLevel}
            onSelectedLevelChange={setSelectedGrammarLevel}
            onOpenFavorites={() => navigateToPage("favorites")}
            onOpenImmersive={() => openGrammarTab("immersive")}
            onOpenQuiz={() => openGrammarTab("quiz")}
            onOpenDetail={openGrammar}
          />
        )}
      </div>
    </GrammarHighlightProvider>
  );

  const renderToolSubpage = (title: string, content: ReactNode) => (
    <div className="space-y-4">
      <div className="page-backbar flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button
          onClick={() => navigateToPage("home")}
          className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8 hover:text-white"
        >
          <ArrowLeft size={17} />
          主页
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">{title}</p>
      </div>
      {content}
    </div>
  );

  const renderPage = () => {
    if (page === "home") {
      return (
        <ZooHome
          overview={overview}
          onNavigate={navigateToPage}
          onOpenWordList={openWordList}
          onOpenGrammarLevel={openGrammarLevel}
          onStartStudy={startCurrentStudyMode}
          onStartMode={startStudyMode}
          activeMode={launchStudyMode}
          onRefreshOverview={refreshOverview}
          onCompleteTodayWords={completeTodayWords}
          onMergeDuplicates={mergeDuplicates}
          onOpenWeeklyReport={openWeeklyReportFrom}
        />
      );
    }
    if (page === "word") {
      return (
        <WordStudy
          key={wordStudyRevision}
          initialMode={launchStudyMode}
          onDailyModeComplete={handleDailyModeComplete}
          onStubbornQuickStudy={startStubbornQuickStudy}
          onOpenDistinctionQuiz={() => startDistinctionQuiz({ kind: "today" })}
        />
      );
    }
    if (page === "team") {
      return <TeamPage />;
    }
    if (page === "quick-study") {
      return renderToolSubpage(
        toolPageTitles["quick-study"] ?? "快速学习",
        <QuickStudyPage
          onNavigate={navigateToPage}
          onDailyModeComplete={() => handleDailyModeComplete("quick")}
          wordIds={stubbornQuickIds ?? undefined}
          heading={stubbornQuickIds ? "顽固词复习" : undefined}
        />
      );
    }
    if (page === "vocab-test") {
      return renderToolSubpage(toolPageTitles["vocab-test"] ?? "查词汇量", <VocabTestPage />);
    }
    if (page === "weekly-report") {
      return (
        <WeeklyReportPage
          key={weeklyReportStart ?? "latest"}
          initialWeekStart={weeklyReportStart}
          onBack={() => navigateToPage("home")}
          onRequirePro={(feature) => setPaywallTarget(feature)}
          onReviewWords={startWeeklyReview}
          entry={weeklyReportEntry}
        />
      );
    }
    if (page === "grammar") {
      return renderGrammarPage();
    }
    if (page === "grammar-foundation") {
      return renderToolSubpage(
        toolPageTitles["grammar-foundation"] ?? "基础语法",
        <GrammarFoundationPage onOpenGrammar={openGrammar} focusRuleId={selectedFoundationRuleId} />
      );
    }
    if (page === "detail") {
      return (
        <GrammarHighlightProvider>
          <div>
            <GrammarDetail
              grammarId={selectedGrammarId}
              getMastery={store.getMastery}
              onBack={() => openGrammarTab("learn")}
              onLearned={markLearnedWithNotice}
              onReview={store.addToReview}
            />
          </div>
        </GrammarHighlightProvider>
      );
    }
    if (page === "profile") {
      return <ProfilePage entitlements={entitlements} cloudSession={cloudSession} onNavigate={navigateToPage} onRequireAuth={() => requireAccount()} onNotice={showNotice} />;
    }
    if (page === "pro") {
      return <ProPage entitlements={entitlements} onBack={goBack} onOpenPaywall={() => setPaywallTarget("general")} onOpenPrivacy={() => navigateToPage("privacy-policy")} />;
    }
    if (page === "yuzu-shop") {
      return renderToolSubpage(toolPageTitles["yuzu-shop"] ?? "柚子商店", <YuzuShopPage />);
    }
    if (page === "favorites") {
      return renderToolSubpage(toolPageTitles.favorites ?? "收藏", <FavoritesPage onOpenGrammar={openGrammar} onStudyPicked={startPickedStudy} />);
    }
    if (page === "word-list") {
      return renderToolSubpage(
        toolPageTitles["word-list"] ?? "选词",
        <WordLibraryPage key={wordListLevel} initialLevel={wordListLevel} onStudyPicked={startPickedStudy} />
      );
    }
    if (page === "kanji-readings") {
      const title = toolPageTitles["kanji-readings"] ?? "一字多音";
      return renderToolSubpage(title, canUseFeature("kanjiReadingUsage", entitlements)
        ? <KanjiReadingUsagePage />
        : <ProReadingPreview title={title} onUpgrade={() => setPaywallTarget("kanjiReadingUsage")}><KanjiReadingUsagePage /></ProReadingPreview>);
    }
    if (page === "confusion") {
      const title = toolPageTitles.confusion ?? "疑难辨析";
      return renderToolSubpage(title, canUseFeature("confusionGroups", entitlements)
        ? <ConfusionPage onQuiz={startDistinctionQuiz} />
        : <ProReadingPreview title={title} onUpgrade={() => setPaywallTarget("confusionGroups")}><ConfusionPage onQuiz={startDistinctionQuiz} /></ProReadingPreview>);
    }
    if (page === "distinction-quiz") {
      return renderToolSubpage(
        toolPageTitles["distinction-quiz"] ?? "辨析练习",
        <DistinctionQuizPage scope={distinctionQuizScope} onBackToConfusion={() => navigateToPage("confusion")} />
      );
    }
    if (page === "jlpt-plan") {
      return (
        <JlptPlanPage
          onBack={goBack}
          onStartWords={startCurrentStudyMode}
          onStartGrammar={() => openGrammarTab("learn")}
        />
      );
    }
    if (page === "study-modes") {
      return renderToolSubpage(
        toolPageTitles["study-modes"] ?? "学习模式",
        <StudyModesPage selectedMode={selectedStudyMode} onModeChange={setSelectedStudyMode} onStart={startStudyMode} />
      );
    }
    // 个人中心子页面
    if (page === "account") {
      return <AccountSecurity onBack={goBack} cloudSession={cloudSession} />;
    }
    if (page === "personal-info") {
      return <PersonalInfo onBack={goBack} onOpenAchievements={() => navigateToPage("achievements")} />;
    }
    if (page === "notifications") {
      return <NotificationSettings onBack={goBack} />;
    }
    if (page === "settings") {
      return <SettingsPage onBack={goBack} onRequireAuth={() => requireAccount()} />;
    }
    if (page === "privacy") {
      return <PrivacySettings onBack={goBack} onOpenPolicy={() => navigateToPage("privacy-policy")} onOpenAgreement={() => navigateToPage("user-agreement")} />;
    }
    if (page === "privacy-policy") {
      return <PrivacyPolicy onBack={goBack} />;
    }
    if (page === "user-agreement") {
      return <UserAgreement onBack={goBack} />;
    }
    if (page === "help") {
      return <HelpPage onBack={goBack} />;
    }
    if (page === "achievements") {
      return <AchievementsPage onBack={goBack} />;
    }

    if (page === "about") {
      return <AboutPage onBack={goBack} />;
    }

    return (
      <WordStudy
        initialMode={launchStudyMode}
        onDailyModeComplete={handleDailyModeComplete}
        onStubbornQuickStudy={startStubbornQuickStudy}
      />
    );
  };

  return (
    <div className={`app-shell ${page === "weekly-report" ? "is-weekly-report" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} relative h-screen overflow-hidden bg-gradient-to-br from-[#FFFBF2] via-[#FDF1DC] to-[#F6E9D2] text-[#3A2E22]`}>
      <div className={`grid h-full min-w-0 transition-[grid-template-columns] duration-200 ${page === "weekly-report" ? "lg:grid-cols-1" : sidebarCollapsed ? "lg:grid-cols-[78px_1fr]" : "lg:grid-cols-[268px_1fr]"}`}>
        {/* 二楼自带返回与章节导航；收起学习工具栏，把手机的阅读高度还给手记。 */}
        {page !== "weekly-report" && <AppNavigation
          page={page}
          sidebarCollapsed={sidebarCollapsed}
          selectedGrammarLevel={selectedGrammarLevel}
          onBack={goBack}
          onNavigate={navigateToPage}
          onOpenGrammarTab={() => openGrammarTab()}
          onSearchResult={handleSearchResult}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          studyMode={page === "word" ? launchStudyMode : null}
        />}

        {/* pb 只留一点呼吸空间:底部导航的位置已经由下面的 bottom 让出来了,
            以前这里是 pb-[6rem](96px),等于同一块空间预留两次,凭空多出一条死白。 */}
        <main className={`app-landscape-main fixed inset-0 min-w-0 px-4 pb-4 pt-4 sm:px-6 lg:static lg:h-screen lg:px-8 lg:py-8 ${readingPreviewLocked ? "overflow-hidden lg:overflow-hidden" : "overflow-y-auto lg:overflow-y-auto"}`} style={{ top: 'var(--app-main-top)', left: 0, right: 0, bottom: 'var(--app-main-bottom)' }}>
          <div className="mx-auto max-w-[1400px]">
            <Suspense fallback={<PageLoading />}>{renderPage()}</Suspense>
          </div>
        </main>
      </div>
      {achievementPop && (
        <div
          className={`zoo-achv-pop${achievementPop.leaving ? " leaving" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="zoo-achv-emoji" aria-hidden="true">{achievementPop.item.emoji}</span>
          <span className="zoo-achv-copy">
            <span className="zoo-achv-kick">成就解锁</span>
            <span className="zoo-achv-name">{achievementPop.item.name}</span>
          </span>
          {achievementPop.rest > 0 && (
            <span className="zoo-achv-rest">还有 {achievementPop.rest} 个</span>
          )}
        </div>
      )}
      {notice && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-[#81D8CF] px-4 py-3 text-sm font-semibold text-[#1f3a36] shadow-lg lg:bottom-5">
          {notice}
        </div>
      )}
      <PersistenceBanner />
      {paywallTarget && (
        <Paywall
          feature={paywallTarget === "general" ? undefined : paywallTarget}
          onClose={() => setPaywallTarget(undefined)}
          onUnlocked={() => setPaywallTarget(undefined)}
          onOpenPrivacy={() => {
            setPaywallTarget(undefined);
            navigateToPage("privacy-policy");
          }}
        />
      )}

      <AuthDialog
        open={authOpen}
        onClose={() => {
          setAuthOpen(false);
          setPendingAccountPage(null);
        }}
        onAuthenticated={handleAuthenticated}
      />
      {levelSetupOpen && <LevelSetup
        open
        onComplete={(message) => {
          setLevelSetupOpen(false);
          showNotice(message, 5200);
          setPageHistory((history) => [...history, page]);
          setPage("jlpt-plan");
        }}
      />}
      {trialEndedOpen && <div className="fixed inset-0 z-[85] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="试用结束">
        <div className="w-full max-w-sm rounded-3xl bg-[#FFF9ED] p-6 shadow-2xl">
          <h2 className="text-xl font-black jp-ink">7 天试用已结束</h2>
          <p className="mt-3 text-sm leading-6 jp-muted">现在计划会继续安排单词。开通 Pro 后，语法、汉字和辨析会按原计划恢复。</p>
          <button className="focus-ring mt-5 h-11 w-full rounded-2xl jp-accent text-sm font-black" onClick={() => {
            const expiresAt = localStorage.getItem(LEVEL_PLAN_TRIAL_EXPIRES_KEY);
            if (expiresAt) localStorage.setItem(LEVEL_PLAN_TRIAL_NOTICE_KEY, expiresAt);
            setTrialEndedOpen(false);
          }}>知道了</button>
        </div>
      </div>}
    </div>
  );
}

/**
 * 「刚才那次没存下去」的常驻提示。
 *
 * ⚠️ 以前 PERSISTENCE_ERROR_EVENT 只有 GrammarHighlightProvider 在听,而那个
 * Provider 只包着语法页 —— 在单词学习页写盘失败时,除了控制台一行 error 之外
 * 什么都不会发生,用户会接着答几十张卡,以为都记下了。所以它挂在常驻层。
 *
 * 不做「正在保存」那一档:正常节奏下每 2 秒就有一次写入,一个每两秒闪一下的
 * 指示器只是噪音。要说的只有「没存下去」和「又好了」。
 */
function PersistenceBanner() {
  const [failed, setFailed] = useState(getPersistenceFailure);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const onError = () => setFailed(getPersistenceFailure());
    const onOk = onError;
    window.addEventListener(PERSISTENCE_ERROR_EVENT, onError);
    window.addEventListener(PERSISTENCE_OK_EVENT, onOk);
    onError();
    return () => {
      window.removeEventListener(PERSISTENCE_ERROR_EVENT, onError);
      window.removeEventListener(PERSISTENCE_OK_EVENT, onOk);
    };
  }, []);

  if (!failed) return null;
  const retry = () => {
    setRetrying(true);
    void saveDatabase()
      .then(() => setFailed(getPersistenceFailure()))
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  };
  return (
    <div
      role="alert"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-1/2 z-[60] flex w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#B3402F] px-4 py-3 text-sm font-semibold text-white shadow-lg lg:bottom-5"
    >
      <CapybaraMascot mood="surprised" size={34} className="shrink-0" />
      <span className="flex-1 leading-5">{failed === 'recovery'
        ? '部分学习记录未能恢复，当前显示较早的存档。请保留本机数据并联系支持；重新保存不能找回缺失的记录。'
        : '学习记录没能保存到本机，请检查存储空间。这期间答的题可能丢失。'}</span>
      {failed === 'save' && <button
        onClick={retry}
        disabled={retrying}
        className="focus-ring shrink-0 rounded-2xl bg-white/15 px-3 py-1.5 text-xs font-bold disabled:opacity-60"
      >
        {retrying ? "重试中" : "重试"}
      </button>}
    </div>
  );
}
