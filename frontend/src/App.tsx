import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppNavigation } from "./components/AppNavigation";
import { useStudyStore } from "./hooks/useStudyStore";
import { useEntitlements } from "./hooks/useEntitlements";
import { canUseFeature, getEntitlements, type FeatureId } from "./lib/entitlements";
import { PROGRESS_UPDATED_EVENT, notifyProgressUpdated } from "./lib/progress-events";
import { loadKanjiUnitIndex } from "./lib/kanji-unit-index";
import { defaultStudyMode, getStudyMode, saveStudyMode, STUDY_MODE_EVENT } from "./lib/studyMode";
import { studyDayEnd } from "./lib/database/db-utils";
import { CLOUD_AUTH_EVENT, CLOUD_SYNC_EVENT, getCloudSession, putCloudWeeklyReport, LEVEL_PLAN_TRIAL_EXPIRES_KEY, LEVEL_PLAN_TRIAL_NOTICE_KEY, type CloudSession, type CloudSyncEventDetail } from "./lib/sync-api";
import { syncUserProfileAfterLogin } from "./lib/profile-sync";
import { requestFullSnapshot, saveDatabase } from "./lib/storage";
import type { SearchResult } from "./lib/search-api";
import type { Page, StudyMode } from "./types/app";
import { ACHIEVEMENT_UNLOCKED_EVENT } from "./lib/userProfile";
import { playStreakChirp } from "./lib/zoo-sounds";
import { triggerAchievementHaptic } from "./lib/haptics";
import { generateLatestWeeklyReport } from "./lib/analytics/weekly-reports";
import { recordWeeklyReportEvent } from "./lib/analytics/weekly-report-events";
import { getStudyPreferences, PREFERENCES_EVENT } from "./lib/studyPreferences";
import { consumePendingWeeklyReportWeekStart, loadReminderSettings, syncWeeklyReportNotification, WEEKLY_REPORT_NOTIFICATION_EVENT } from "./lib/notifications";
import { OPEN_GRAMMAR_FOUNDATION_EVENT } from "./lib/grammar-foundation-navigation";
import { shouldShowLevelSetup } from "./lib/level-plan";
import { AppShell, markTrialNoticeRead } from "./app/AppShell";
import type { AppContextValue } from "./app/AppContext";
import { createAppActions } from "./app/actions";
import { getAppState, setAppState, useAppState } from "./app/app-store";
import { PageLoading } from "./routes/shared";
import { ROUTES } from "./routes";
import { getProgressOverview } from "./lib/api";

const accountProtectedPages = new Set<Page>(["account", "personal-info", "team"]);
const proPages: Partial<Record<Page, FeatureId>> = { "distinction-quiz": "confusionGroups" };
const proReadingPages: Partial<Record<Page, FeatureId>> = {
  confusion: "confusionGroups",
  "kanji-readings": "kanjiReadingUsage"
};
const ACHIEVEMENT_POP_HOLD_MS = 1700;
const ACHIEVEMENT_POP_OUT_MS = 260;

export default function App() {
  const state = useAppState();
  const page = state.page;
  const studyStore = useStudyStore();
  const entitlements = useEntitlements();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [noticeState, setNoticeState] = useState<{ message: string; timeout: number } | null>(null);
  const notice = noticeState?.message ?? "";
  const [overview, setOverview] = useState(() => getProgressOverview());
  const [paywallTarget, setPaywallTarget] = useState<FeatureId | "general">();
  const readingPreviewFeature = proReadingPages[page]
    ?? (page === "grammar" && state.grammarMode === "immersive" ? "immersiveGrammar" : undefined);
  const readingPreviewLocked = Boolean(readingPreviewFeature && !canUseFeature(readingPreviewFeature, entitlements));
  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false });
  const [authOpen, setAuthOpen] = useState(false);
  const [levelSetupOpen, setLevelSetupOpen] = useState(() => {
    try { return shouldShowLevelSetup(); } catch { return false; }
  });
  const [trialEndedOpen, setTrialEndedOpen] = useState(false);
  const [weeklyReportEnabled, setWeeklyReportEnabled] = useState(() => getStudyPreferences().weeklyReportEnabled);
  const savedWeeklyReportStartRef = useRef<string | null>(null);
  const uploadedWeeklyReportStartRef = useRef<string | null>(null);
  const weeklyNotificationKeyRef = useRef<string | null>(null);
  const syncConflictNoticeRef = useRef("");

  useEffect(() => {
    if (!readingPreviewLocked) return;
    document.querySelector<HTMLElement>("main.app-landscape-main")?.scrollTo({ top: 0 });
  }, [page, readingPreviewLocked]);

  useEffect(() => {
    let alive = true;
    void getCloudSession().then((session) => { if (alive) setCloudSession(session); });
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

  useEffect(() => {
    const sync = () => setAppState({ selectedStudyMode: getStudyMode() || defaultStudyMode });
    window.addEventListener(STUDY_MODE_EVENT, sync);
    return () => window.removeEventListener(STUDY_MODE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!weeklyReportEnabled) return undefined;
    const syncLatestReport = () => {
      try {
        const snapshot = generateLatestWeeklyReport("local");
        if (snapshot && savedWeeklyReportStartRef.current !== snapshot.report.window.start) {
          savedWeeklyReportStartRef.current = snapshot.report.window.start;
          recordWeeklyReportEvent({ kind: "available", weekStart: snapshot.report.window.start, at: Date.now() });
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
    const timer = window.setInterval(syncLatestReport, 60_000);
    return () => window.clearInterval(timer);
  }, [entitlements.isPro, cloudSession.email, weeklyReportEnabled]);

  // 这份总览只有首页在读，而它是两条全库 words⋈progress 扫描。以前它挂在
  // PROGRESS_UPDATED 上无条件重算，学习页里每答一张卡都要重算一份看不见的内容。
  // 离开首页时只记脏标记，回到首页再补算。
  const overviewVisible = page === "home";
  const overviewDirtyRef = useRef(false);
  // 字音单位索引是动态 import 的独立 chunk。加载后还要广播进度事件：ZooHome
  // 有自己的 getWordStats 快照，只在挂载时读一次。
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
    // 模式按凌晨 4 点自动恢复。正在背卡时不改 initialMode，离开学习页再读取。
    if (page === "word") return;
    const syncEffectiveMode = () => {
      const currentMode = getStudyMode();
      setAppState({ selectedStudyMode: currentMode, launchStudyMode: currentMode });
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

  const achievementQueueRef = useRef<{ emoji: string; name: string }[]>([]);
  const [achievementPop, setAchievementPop] = useState<{
    item: { emoji: string; name: string };
    rest: number;
    leaving: boolean;
  } | null>(null);

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
        setAchievementPop((current) => current ? { ...current, leaving: true } : current);
        timer = window.setTimeout(step, ACHIEVEMENT_POP_OUT_MS);
      }, ACHIEVEMENT_POP_HOLD_MS);
    };
    const onUnlock = (event: Event) => {
      const achievement = (event as CustomEvent<{ emoji: string; name: string }>).detail;
      if (!achievement) return;
      achievementQueueRef.current.push({ emoji: achievement.emoji, name: achievement.name });
      if (playing) return;
      playing = true;
      // 同一批解锁事件同步发出；延一拍后才能统计队列里还剩几条。
      timer = window.setTimeout(step, 0);
    };
    window.addEventListener(ACHIEVEMENT_UNLOCKED_EVENT, onUnlock);
    return () => {
      window.removeEventListener(ACHIEVEMENT_UNLOCKED_EVENT, onUnlock);
      window.clearTimeout(timer);
    };
  }, []);

  const showNotice = useCallback((message: string, timeout = 1800) => {
    setNoticeState({ message, timeout });
  }, []);

  useEffect(() => {
    if (!noticeState) return undefined;
    const timer = window.setTimeout(() => setNoticeState(null), noticeState.timeout);
    return () => window.clearTimeout(timer);
  }, [noticeState]);

  useEffect(() => {
    const handleCloudSync = (event: Event) => {
      const detail = (event as CustomEvent<CloudSyncEventDetail>).detail;
      if (!detail) return;
      if (detail.status === "downloaded" || detail.status === "merged") {
        syncConflictNoticeRef.current = "";
        uploadedWeeklyReportStartRef.current = null;
        setOverview(getProgressOverview());
        try {
          generateLatestWeeklyReport("local", new Date(), true);
          requestFullSnapshot();
          void saveDatabase().catch(() => undefined);
        } catch { /* 周报刷新不阻断同步 */ }
      } else if (detail.status === "uploaded") {
        syncConflictNoticeRef.current = "";
      } else if (detail.status === "conflict" || detail.status === "signed-out") {
        const message = detail.message ?? "两台设备都有新进度，请到设置中手动处理。";
        if (syncConflictNoticeRef.current === message) return;
        syncConflictNoticeRef.current = message;
        showNotice(message, 5000);
      }
    };
    window.addEventListener(CLOUD_SYNC_EVENT, handleCloudSync);
    return () => window.removeEventListener(CLOUD_SYNC_EVENT, handleCloudSync);
  }, [showNotice]);

  const navigateToPage = useCallback((newPage: Page, studyModeOverride?: StudyMode) => {
    // 顽固词名单是一次性的；普通入口进入快速学习时回到今日默认列表。
    if (newPage === "quick-study") setAppState({ stubbornQuickIds: null });
    if (accountProtectedPages.has(newPage) && !cloudSession.token) {
      setAppState({ pendingAccountPage: newPage });
      setAuthOpen(true);
      return;
    }
    const proFeature = proPages[newPage];
    if (proFeature && !canUseFeature(proFeature, entitlements)) {
      setPaywallTarget(proFeature);
      return;
    }
    const current = getAppState();
    let patch: Partial<typeof current> = {};
    if (newPage === "word") {
      const currentMode = studyModeOverride ?? getStudyMode() ?? defaultStudyMode;
      // 所有混合模式入口都从这里拦；被锁时也把持久模式退回经典，避免下次启动再撞付费窗。
      if (currentMode === "mixed" && !canUseFeature("mixedStudy", entitlements)) {
        saveStudyMode(defaultStudyMode);
        setAppState({ selectedStudyMode: defaultStudyMode });
        setPaywallTarget("mixedStudy");
        return;
      }
      patch = { ...patch, selectedStudyMode: currentMode, launchStudyMode: currentMode, wordStudyRevision: current.wordStudyRevision + 1 };
    }
    if (newPage === "home" || newPage === "study-modes") {
      const currentMode = getStudyMode();
      patch = { ...patch, selectedStudyMode: currentMode, launchStudyMode: currentMode };
    }
    if (newPage === "home" || newPage === "profile") patch = { ...patch, selectedGrammarId: "wa" };
    if (newPage === "grammar-foundation") patch = { ...patch, selectedFoundationRuleId: null };
    if (newPage !== current.page) {
      setAppState({ ...patch, pageHistory: [...current.pageHistory, current.page], page: newPage });
    } else if (Object.keys(patch).length) {
      setAppState(patch);
    }
  }, [cloudSession.token, entitlements]);

  const navigate = (target: Page, params?: Parameters<AppContextValue["navigate"]>[1]) => {
    if (params) {
      const { studyMode, ...routeParams } = params;
      setAppState(routeParams);
      navigateToPage(target, studyMode);
    } else {
      navigateToPage(target);
    }
  };

  const goBack = () => {
    const current = getAppState();
    if (current.pageHistory.length) {
      setAppState({ pageHistory: current.pageHistory.slice(0, -1), page: current.pageHistory[current.pageHistory.length - 1] });
    } else {
      setAppState({ page: "home" });
    }
  };

  const requireAccount = (target?: Page) => {
    if (cloudSession.token) {
      if (target) navigateToPage(target);
      return;
    }
    setAppState({ pendingAccountPage: target ?? null });
    setAuthOpen(true);
  };

  const handleAuthenticated = async (session: CloudSession) => {
    setCloudSession(session);
    try {
      await syncUserProfileAfterLogin(session);
    } catch {
      showNotice("账号已登录；个人资料将在恢复联网后继续同步。", 3200);
    }
    const { pendingAccountPage } = getAppState();
    if (pendingAccountPage) {
      setAppState((current) => ({
        pendingAccountPage: null,
        ...(pendingAccountPage !== current.page ? { pageHistory: [...current.pageHistory, current.page], page: pendingAccountPage } : {})
      }));
    }
  };

  const actions = createAppActions({
    navigate: navigateToPage,
    showNotice,
    setOverview,
    confirm: (message) => window.confirm(message),
    markLearned: studyStore.markLearned,
    recordReview: studyStore.recordReview
  });

  const context: AppContextValue = {
    state,
    navigate,
    goBack,
    showNotice,
    requirePro: (featureId) => setPaywallTarget(featureId),
    requireAccount,
    openLevelSetup: () => setLevelSetupOpen(true),
    closePaywall: () => setPaywallTarget(undefined),
    closeAuth: () => {
      setAuthOpen(false);
      setAppState({ pendingAccountPage: null });
    },
    handleAuthenticated,
    cloudSession,
    entitlements,
    studyStore,
    overview,
    actions
  };

  useEffect(() => {
    const openFoundationRule = (event: Event) => {
      const ruleId = (event as CustomEvent<{ ruleId?: string }>).detail?.ruleId;
      navigateToPage("grammar-foundation");
      setAppState({ selectedFoundationRuleId: ruleId ?? null });
    };
    window.addEventListener(OPEN_GRAMMAR_FOUNDATION_EVENT, openFoundationRule);
    return () => window.removeEventListener(OPEN_GRAMMAR_FOUNDATION_EVENT, openFoundationRule);
  }, [navigateToPage]);

  useEffect(() => {
    const openWeeklyReport = (weekStart: string | null) => {
      setAppState({ weeklyReportStart: weekStart, weeklyReportEntry: "notification" });
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

  const handleSearchResult = (result: SearchResult) => actions.handleSearchResult(result);
  const CurrentRoute = ROUTES[page];

  return (
    <AppShell
      context={context}
      className={`app-shell ${page === "weekly-report" ? "is-weekly-report" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} relative h-screen overflow-hidden bg-gradient-to-br from-[#FFFBF2] via-[#FDF1DC] to-[#F6E9D2] text-[#3A2E22]`}
      achievementPop={achievementPop}
      notice={notice}
      paywallTarget={paywallTarget}
      authOpen={authOpen}
      levelSetupOpen={levelSetupOpen}
      trialEndedOpen={trialEndedOpen}
      onAuthenticated={handleAuthenticated}
      onClosePaywall={() => setPaywallTarget(undefined)}
      onCloseAuth={() => {
        setAuthOpen(false);
        setAppState({ pendingAccountPage: null });
      }}
      onLevelSetupComplete={(message) => {
        setLevelSetupOpen(false);
        showNotice(message, 5200);
        const current = getAppState();
        setAppState({ pageHistory: [...current.pageHistory, current.page], page: "jlpt-plan" });
      }}
      onDismissTrial={() => {
        markTrialNoticeRead();
        setTrialEndedOpen(false);
      }}
      onViewPro={() => {
        markTrialNoticeRead();
        setTrialEndedOpen(false);
        navigateToPage("pro");
      }}
    >
        <div className={`grid h-full min-w-0 transition-[grid-template-columns] duration-200 ${page === "weekly-report" ? "lg:grid-cols-1" : sidebarCollapsed ? "lg:grid-cols-[78px_1fr]" : "lg:grid-cols-[268px_1fr]"}`}>
          {page !== "weekly-report" && <AppNavigation
            page={page}
            sidebarCollapsed={sidebarCollapsed}
            selectedGrammarLevel={state.selectedGrammarLevel}
            onBack={goBack}
            onNavigate={navigateToPage}
            onOpenGrammarTab={() => actions.openGrammarTab()}
            onSearchResult={handleSearchResult}
            onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
            studyMode={page === "word" ? state.launchStudyMode : null}
          />}
          <main className={`app-landscape-main fixed inset-0 min-w-0 px-4 pb-4 pt-4 sm:px-6 lg:static lg:h-screen lg:px-8 lg:py-8 ${readingPreviewLocked ? "overflow-hidden lg:overflow-hidden" : "overflow-y-auto lg:overflow-y-auto"}`} style={{ top: "var(--app-main-top)", left: 0, right: 0, bottom: "var(--app-main-bottom)" }}>
            <div className="mx-auto max-w-[1400px]">
              <Suspense fallback={<PageLoading />}><CurrentRoute /></Suspense>
            </div>
          </main>
        </div>
    </AppShell>
  );
}
