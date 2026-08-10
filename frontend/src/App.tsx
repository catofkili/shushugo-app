import { lazy, ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { WordStudy } from "./pages/WordStudy";
import { AppNavigation } from "./components/AppNavigation";
import { ZooHome } from "./components/ZooHome";
import { FillProgressModal } from "./components/FillProgressModal";
import { Paywall } from "./components/Paywall";
import { AuthDialog } from "./components/AuthDialog";
import { useStudyStore } from "./hooks/useStudyStore";
import { useEntitlements } from "./hooks/useEntitlements";
import { completeTodayWordPlan, getProgressOverview, markContentComplete, ProgressOverview } from "./lib/api";
import { canUseFeature, FeatureId } from "./lib/entitlements";
import { PROGRESS_UPDATED_EVENT } from "./lib/progress-events";
import { activateMistakesForToday, defaultStudyMode, getStudyMode, saveStudyMode, studyModeInfo } from "./lib/studyMode";
import { studyDayEnd } from "./lib/database/db-utils";
import { CLOUD_AUTH_EVENT, CLOUD_SYNC_EVENT, getCloudSession, type CloudSession, type CloudSyncEventDetail } from "./lib/sync-api";
import { syncUserProfileAfterLogin } from "./lib/profile-sync";
import type { SearchResult } from "./lib/search-api";
import { GrammarMode, Page, StudyMode } from "./types/app";
import { JLPTLevel } from "./types/grammar";

const Library = lazy(() => import("./pages/Library").then((module) => ({ default: module.Library })));
const GrammarDetail = lazy(() => import("./pages/GrammarDetail").then((module) => ({ default: module.GrammarDetail })));
const QuizPage = lazy(() => import("./pages/QuizPage").then((module) => ({ default: module.QuizPage })));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage").then((module) => ({ default: module.FavoritesPage })));
const ImmersiveGrammar = lazy(() => import("./pages/ImmersiveGrammar").then((module) => ({ default: module.ImmersiveGrammar })));
const PersonalInfo = lazy(() => import("./pages/PersonalInfo").then((module) => ({ default: module.PersonalInfo })));
const AccountSecurity = lazy(() => import("./pages/AccountSecurity").then((module) => ({ default: module.AccountSecurity })));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings").then((module) => ({ default: module.NotificationSettings })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const PrivacySettings = lazy(() => import("./pages/PrivacySettings").then((module) => ({ default: module.PrivacySettings })));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy").then((module) => ({ default: module.PrivacyPolicy })));
const UserAgreement = lazy(() => import("./pages/UserAgreement").then((module) => ({ default: module.UserAgreement })));
const HelpPage = lazy(() => import("./pages/HelpPage").then((module) => ({ default: module.HelpPage })));
const AboutPage = lazy(() => import("./pages/AboutPage").then((module) => ({ default: module.AboutPage })));
const ProPage = lazy(() => import("./pages/ProPage").then((module) => ({ default: module.ProPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const StudyModesPage = lazy(() => import("./pages/StudyModesPage").then((module) => ({ default: module.StudyModesPage })));
const TeamPage = lazy(() => import("./pages/TeamPage").then((module) => ({ default: module.TeamPage })));
const ZooMapPage = lazy(() => import("./pages/ZooMapPage").then((module) => ({ default: module.ZooMapPage })));
const ZooDexPage = lazy(() => import("./pages/ZooDexPage").then((module) => ({ default: module.ZooDexPage })));
const HotSpringPage = lazy(() => import("./pages/HotSpringPage").then((module) => ({ default: module.HotSpringPage })));
const QuickStudyPage = lazy(() => import("./pages/QuickStudyPage").then((module) => ({ default: module.QuickStudyPage })));

const PageLoading = () => (
  <div className="grid min-h-[40vh] place-items-center overflow-y-auto rounded-2xl border border-white/15 bg-[#464949] p-6 text-sm font-semibold text-white/65" aria-busy="true">
    正在加载页面...
  </div>
);

const toolPageTitles: Partial<Record<Page, string>> = {
  "study-modes": "学习模式",
  favorites: "收藏",
  "quick-study": "快速学习"
};

const accountProtectedPages = new Set<Page>(["account", "personal-info"]);

export default function App() {
  const store = useStudyStore();
  const entitlements = useEntitlements();
  const [page, setPage] = useState<Page>("home");
  const [pageHistory, setPageHistory] = useState<Page[]>([]); // 页面历史栈
  const [grammarMode, setGrammarMode] = useState<GrammarMode>("learn");
  const [selectedGrammarId, setSelectedGrammarId] = useState("wa");
  const [selectedGrammarLevel, setSelectedGrammarLevel] = useState<"All" | JLPTLevel>("N5");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notice, setNotice] = useState("");
  const [overview, setOverview] = useState<ProgressOverview>(() => getProgressOverview());
  const [fillOpen, setFillOpen] = useState(false);
  const [fillGrammarLevels, setFillGrammarLevels] = useState<JLPTLevel[]>([]);
  const [fillWordLevels, setFillWordLevels] = useState<JLPTLevel[]>([]);
  const [fillAllWords, setFillAllWords] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<FeatureId | undefined>();
  const [selectedStudyMode, setSelectedStudyMode] = useState<StudyMode>(() => getStudyMode() || defaultStudyMode);
  const [launchStudyMode, setLaunchStudyMode] = useState<StudyMode>(() => getStudyMode() || defaultStudyMode);
  const [wordStudyRevision, setWordStudyRevision] = useState(0);
  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false });
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingAccountPage, setPendingAccountPage] = useState<Page | null>(null);

  useEffect(() => {
    let alive = true;
    void getCloudSession().then((session) => {
      if (alive) setCloudSession(session);
    });
    const refreshAuth = (event: Event) => {
      const session = (event as CustomEvent<CloudSession>).detail;
      if (session) setCloudSession(session);
    };
    window.addEventListener(CLOUD_AUTH_EVENT, refreshAuth);
    return () => {
      alive = false;
      window.removeEventListener(CLOUD_AUTH_EVENT, refreshAuth);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setOverview(getProgressOverview());
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
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
        setOverview(getProgressOverview());
        // 背单词时不能因为后台同步重挂载 WordStudy,否则当前卡会被重新抽取。
        // 当前学习会话继续使用本地状态,答完后自然会读到最新数据库。
      } else if (detail.status === "merged") {
        syncConflictNoticeRef.current = "";
        setOverview(getProgressOverview());
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
  const navigateToPage = (newPage: Page, studyModeOverride?: StudyMode) => {
    if (accountProtectedPages.has(newPage) && !cloudSession.token) {
      setPendingAccountPage(newPage);
      setAuthOpen(true);
      return;
    }
    if (newPage === "word") {
      const currentMode = studyModeOverride ?? getStudyMode() ?? defaultStudyMode;
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
    if (newPage !== page) {
      setPageHistory([...pageHistory, page]);
      setPage(newPage);
    }
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

  const requirePro = (feature: FeatureId, action: () => void) => {
    if (canUseFeature(feature, entitlements)) {
      action();
      return;
    }
    setPaywallFeature(feature);
  };

  const openGrammar = (id: string) => {
    setSelectedGrammarId(id);
    navigateToPage("detail");
  };

  const openGrammarTab = (mode: GrammarMode = "learn") => {
    setGrammarMode(mode);
    if (mode === "learn") {
      setSelectedGrammarId("wa");
      setSelectedGrammarLevel("N5");
    }
    navigateToPage("grammar");
  };

  const addMistake = (
    grammarId: string,
    questionId: string,
    prompt: string,
    userAnswer: string,
    correctAnswer: string,
    explanation: string
  ) => {
    store.addMistake({ grammarId, questionId, prompt, userAnswer, correctAnswer, explanation });
    store.addToReview(grammarId);
  };

  const markLearnedWithNotice = (id: string) => {
    store.markLearned(id);
    setOverview(getProgressOverview());
    showNotice("已标记为掌握，并保存到本地进度。");
  };

  const markForgotWithNotice = (id: string) => {
    store.recordReview(id, false);
    store.addToReview(id);
    showNotice("已固定到前面，稍后继续看。");
  };

  const refreshOverview = () => setOverview(getProgressOverview());

  const completeSelectedContent = () => {
    const data = markContentComplete({ grammarLevels: fillGrammarLevels, wordLevels: fillWordLevels, allWords: fillAllWords });
    setOverview(data);
    setFillOpen(false);
    showNotice(fillAllWords || fillWordLevels.length || fillGrammarLevels.length ? "已同步勾选范围。" : "已清空一键填满状态。");
  };

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

  const toggleFillLevel = (kind: "word" | "grammar", level: JLPTLevel) => {
    const update = (current: JLPTLevel[]) => current.includes(level) ? current.filter((item) => item !== level) : [...current, level];
    if (kind === "word") {
      setFillWordLevels(update);
      return;
    }
    setFillGrammarLevels(update);
  };

  const renderGrammarTabs = () => (
    <div className="control-cyan mb-3 flex items-center justify-between gap-3 rounded-2xl border p-1">
      <div className="grid flex-1 grid-cols-2 gap-1">
        <button
          onClick={() => openGrammarTab("learn")}
          className={`focus-ring soft-text-outline rounded-xl px-3 py-2 text-sm font-bold transition-all duration-300 ${grammarMode === "learn" && page !== "detail" ? "bg-[#81D8CF] !text-[#343838] shadow-[0_4px_16px_rgba(143,203,94,0.4),inset_0_1px_0_rgba(255,255,255,0.4)]" : "text-[#1f514d]/75 hover:bg-[#81D8CF]/20"}`}
        >
          学习
        </button>
        <button
          onClick={() => openGrammarTab("practice")}
          className={`focus-ring soft-text-outline rounded-xl px-3 py-2 text-sm font-bold transition-all duration-300 ${grammarMode === "practice" && page !== "detail" ? "bg-[#81D8CF] !text-[#343838] shadow-[0_4px_16px_rgba(143,203,94,0.4),inset_0_1px_0_rgba(255,255,255,0.4)]" : "text-[#1f514d]/75 hover:bg-[#81D8CF]/20"}`}
        >
          练习
        </button>
      </div>
      <select
        value={selectedGrammarLevel}
        onChange={(event) => setSelectedGrammarLevel(event.target.value as "All" | JLPTLevel)}
        className="focus-ring control-cyan soft-text-outline h-9 w-[74px] rounded-xl border px-1.5 text-xs font-bold"
        title="选择语法等级"
      >
        <option value="All">全部</option>
        <option value="N5">N5</option>
        <option value="N4">N4</option>
        <option value="N3">N3</option>
        <option value="N2">N2</option>
        <option value="N1">N1</option>
      </select>
    </div>
  );

  const renderGrammarPage = () => (
    <div>
      {renderGrammarTabs()}
      {grammarMode === "learn" ? (
        <Library
          getMastery={store.getMastery}
          onMarkLearned={markLearnedWithNotice}
          onMarkForgot={markForgotWithNotice}
          selectedLevel={selectedGrammarLevel}
          onSelectedLevelChange={setSelectedGrammarLevel}
          onOpenFavorites={() => navigateToPage("favorites")}
          onOpenImmersive={() => requirePro("immersiveGrammar", () => openGrammarTab("immersive"))}
          onOpenDetail={openGrammar}
        />
      ) : grammarMode === "practice" ? (
        <QuizPage onMistake={addMistake} selectedLevel={selectedGrammarLevel} />
      ) : (
        <ImmersiveGrammar
          selectedLevel={selectedGrammarLevel}
          onBack={() => openGrammarTab("learn")}
          onOpenFavorites={() => navigateToPage("favorites")}
          onMarkLearned={markLearnedWithNotice}
        />
      )}
    </div>
  );

  const renderToolSubpage = (title: string, content: ReactNode) => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
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
          onStartStudy={startCurrentStudyMode}
          onStartMode={startStudyMode}
          activeMode={launchStudyMode}
          onOpenFill={() => setFillOpen(true)}
          onRefreshOverview={refreshOverview}
          onCompleteTodayWords={completeTodayWords}
        />
      );
    }
    if (page === "word") {
      return <WordStudy key={wordStudyRevision} initialMode={launchStudyMode} onDailyModeComplete={handleDailyModeComplete} />;
    }
    if (page === "team") {
      return <TeamPage />;
    }
    if (page === "zoo-map") {
      return <ZooMapPage overview={overview} />;
    }
    if (page === "zoo-dex") {
      return <ZooDexPage overview={overview} />;
    }
    if (page === "hot-spring") {
      return <HotSpringPage onNavigate={navigateToPage} />;
    }
    if (page === "quick-study") {
      return renderToolSubpage(
        toolPageTitles["quick-study"] ?? "快速学习",
        <QuickStudyPage onNavigate={navigateToPage} onDailyModeComplete={() => handleDailyModeComplete("quick")} />
      );
    }
    if (page === "grammar") {
      return renderGrammarPage();
    }
    if (page === "detail") {
      return (
        <div>
          {renderGrammarTabs()}
          <GrammarDetail
            grammarId={selectedGrammarId}
            getMastery={store.getMastery}
            onBack={() => openGrammarTab("learn")}
            onPractice={() => openGrammarTab("practice")}
            onLearned={markLearnedWithNotice}
            onReview={store.addToReview}
            onMistake={addMistake}
          />
        </div>
      );
    }
    if (page === "profile") {
      return <ProfilePage entitlements={entitlements} cloudSession={cloudSession} onNavigate={navigateToPage} onRequireAuth={() => requireAccount()} onNotice={showNotice} />;
    }
    if (page === "pro") {
      return <ProPage entitlements={entitlements} onBack={goBack} onOpenPaywall={() => setPaywallFeature("fullJlptPlan")} onOpenPrivacy={() => navigateToPage("privacy-policy")} />;
    }
    if (page === "favorites") {
      return renderToolSubpage(toolPageTitles.favorites ?? "收藏", <FavoritesPage onOpenGrammar={openGrammar} />);
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
      return <PersonalInfo onBack={goBack} />;
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
    if (page === "about") {
      return <AboutPage onBack={goBack} />;
    }

    return <WordStudy initialMode={launchStudyMode} onDailyModeComplete={handleDailyModeComplete} />;
  };

  return (
    <div className="app-shell relative h-screen overflow-hidden bg-gradient-to-br from-[#FFFBF2] via-[#FDF1DC] to-[#F6E9D2] text-[#3A2E22]">
      <div className={`grid h-full min-w-0 transition-[grid-template-columns] duration-200 ${sidebarCollapsed ? "lg:grid-cols-[78px_1fr]" : "lg:grid-cols-[268px_1fr]"}`}>
        <AppNavigation
          page={page}
          sidebarCollapsed={sidebarCollapsed}
          selectedGrammarLevel={selectedGrammarLevel}
          onBack={goBack}
          onNavigate={navigateToPage}
          onOpenGrammarTab={() => openGrammarTab()}
          onSearchResult={handleSearchResult}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          studyMode={page === "word" ? launchStudyMode : null}
        />

        {/* pb 只留一点呼吸空间:底部导航的位置已经由下面的 bottom 让出来了,
            以前这里是 pb-[6rem](96px),等于同一块空间预留两次,凭空多出一条死白。 */}
        <main className="app-landscape-main fixed inset-0 min-w-0 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 lg:static lg:h-screen lg:overflow-y-auto lg:px-8 lg:py-8" style={{ top: 'var(--app-main-top)', left: 0, right: 0, bottom: 'var(--app-main-bottom)' }}>
          <div className="mx-auto max-w-[1400px]">
            <Suspense fallback={<PageLoading />}>{renderPage()}</Suspense>
          </div>
        </main>
      </div>
      {notice && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-[#81D8CF] px-4 py-3 text-sm font-semibold text-[#1f3a36] shadow-lg lg:bottom-5">
          {notice}
        </div>
      )}
      {paywallFeature && (
        <Paywall
          feature={paywallFeature}
          onClose={() => setPaywallFeature(undefined)}
          onUnlocked={() => setPaywallFeature(undefined)}
          onOpenPrivacy={() => {
            setPaywallFeature(undefined);
            navigateToPage("privacy-policy");
          }}
        />
      )}

      {fillOpen && (
        <FillProgressModal
          fillAllWords={fillAllWords}
          fillWordLevels={fillWordLevels}
          fillGrammarLevels={fillGrammarLevels}
          onClose={() => setFillOpen(false)}
          onConfirm={completeSelectedContent}
          onToggleAllWords={() => {
            setFillAllWords((value) => !value);
            setFillWordLevels([]);
          }}
          onToggleLevel={toggleFillLevel}
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
    </div>
  );
}
