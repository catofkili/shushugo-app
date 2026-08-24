import { lazy, ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { WordStudy } from "./pages/WordStudy";
import { AppNavigation } from "./components/AppNavigation";
import { ZooHome } from "./components/ZooHome";
import { FillProgressModal } from "./components/FillProgressModal";
import { Paywall } from "./components/Paywall";
import { AuthDialog } from "./components/AuthDialog";
import { GrammarHighlightProvider } from "./components/GrammarHighlightProvider";
import { useStudyStore } from "./hooks/useStudyStore";
import { useEntitlements } from "./hooks/useEntitlements";
import { completeTodayWordPlan, getProgressOverview, markContentComplete, startPickedStudy as startPickedWordStudy, ProgressOverview } from "./lib/api";
import { canUseFeature, FeatureId } from "./lib/entitlements";
import { PROGRESS_UPDATED_EVENT, notifyProgressUpdated } from "./lib/progress-events";
import { loadKanjiUnitIndex } from "./lib/kanji-unit-index";
import { activateMistakesForToday, defaultStudyMode, getStudyMode, saveStudyMode, studyModeInfo } from "./lib/studyMode";
import { studyDayEnd } from "./lib/database/db-utils";
import { getGrammarLevelPreference, saveGrammarLevelPreference, type GrammarLevelSelection } from "./lib/grammarPreferences";
import { CLOUD_AUTH_EVENT, CLOUD_SYNC_EVENT, getCloudSession, type CloudSession, type CloudSyncEventDetail } from "./lib/sync-api";
import { syncUserProfileAfterLogin } from "./lib/profile-sync";
import type { SearchResult } from "./lib/search-api";
import { GrammarMode, Page, StudyMode } from "./types/app";
import { JLPTLevel } from "./types/grammar";
import type { LibraryLevel } from "./lib/word-library";
import { AchievementsPage } from "./pages/AchievementsPage";
import { ACHIEVEMENT_UNLOCKED_EVENT } from "./lib/userProfile";
import { playStreakChirp } from "./lib/zoo-sounds";
import { triggerAchievementHaptic } from "./lib/haptics";

const Library = lazy(() => import("./pages/Library").then((module) => ({ default: module.Library })));
const GrammarDetail = lazy(() => import("./pages/GrammarDetail").then((module) => ({ default: module.GrammarDetail })));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage").then((module) => ({ default: module.FavoritesPage })));
const ConfusionPage = lazy(() => import("./pages/ConfusionPage").then((module) => ({ default: module.ConfusionPage })));
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
const ZooMapPage = lazy(() => import("./pages/ZooMapPage").then((module) => ({ default: module.ZooMapPage })));
const ZooDexPage = lazy(() => import("./pages/ZooDexPage").then((module) => ({ default: module.ZooDexPage })));
const HotSpringPage = lazy(() => import("./pages/HotSpringPage").then((module) => ({ default: module.HotSpringPage })));
const QuickStudyPage = lazy(() => import("./pages/QuickStudyPage").then((module) => ({ default: module.QuickStudyPage })));
const WordLibraryPage = lazy(() => import("./pages/WordLibraryPage").then((module) => ({ default: module.WordLibraryPage })));

const PageLoading = () => (
  <div className="grid min-h-[40vh] place-items-center overflow-y-auto rounded-2xl border border-white/15 bg-[#464949] p-6 text-sm font-semibold text-white/65" aria-busy="true">
    正在加载页面...
  </div>
);

const toolPageTitles: Partial<Record<Page, string>> = {
  "study-modes": "学习模式",
  favorites: "收藏",
  confusion: "疑难辨析",
  "kanji-readings": "一字多音",
  "word-list": "选词",
  "quick-study": "快速学习"
};

const accountProtectedPages = new Set<Page>(["account", "personal-info"]);

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
  const [selectedGrammarLevel, setSelectedGrammarLevelState] = useState<GrammarLevelSelection>(getGrammarLevelPreference);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notice, setNotice] = useState("");
  const [overview, setOverview] = useState<ProgressOverview>(() => getProgressOverview());
  const [fillOpen, setFillOpen] = useState(false);
  const [fillGrammarLevels, setFillGrammarLevels] = useState<JLPTLevel[]>([]);
  const [fillWordLevels, setFillWordLevels] = useState<JLPTLevel[]>([]);
  const [fillAllWords, setFillAllWords] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<FeatureId | undefined>();
  // 词库页的预设等级：进度概览点 N5 那根柱子进来时带着它
  const [wordListLevel, setWordListLevel] = useState<LibraryLevel>("all");
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

  const renderGrammarPage = () => (
    <GrammarHighlightProvider>
      <div>
        {grammarMode === "quiz" ? (
          <GrammarQuiz
            initialLevel={selectedGrammarLevel === "All" ? null : selectedGrammarLevel}
            onBack={() => openGrammarTab("learn")}
          />
        ) : grammarMode === "immersive" ? (
          <ImmersiveGrammar
            key={selectedGrammarLevel}
            selectedLevel={selectedGrammarLevel}
            onBack={() => openGrammarTab("learn")}
            onOpenFavorites={() => navigateToPage("favorites")}
            onMarkLearned={markLearnedWithNotice}
          />
        ) : (
          <Library
            getMastery={store.getMastery}
            onMarkLearned={markLearnedWithNotice}
            onMarkForgot={markForgotWithNotice}
            selectedLevel={selectedGrammarLevel}
            onSelectedLevelChange={setSelectedGrammarLevel}
            onOpenFavorites={() => navigateToPage("favorites")}
            onOpenImmersive={() => requirePro("immersiveGrammar", () => openGrammarTab("immersive"))}
            onOpenQuiz={() => openGrammarTab("quiz")}
            onOpenDetail={openGrammar}
          />
        )}
      </div>
    </GrammarHighlightProvider>
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
          onOpenWordList={openWordList}
          onOpenGrammarLevel={openGrammarLevel}
          onStartStudy={startCurrentStudyMode}
          onStartMode={startStudyMode}
          activeMode={launchStudyMode}
          onOpenFill={() => setFillOpen(true)}
          onRefreshOverview={refreshOverview}
          onCompleteTodayWords={completeTodayWords}
          onMergeDuplicates={mergeDuplicates}
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
      return <ProPage entitlements={entitlements} onBack={goBack} onOpenPaywall={() => setPaywallFeature("fullJlptPlan")} onOpenPrivacy={() => navigateToPage("privacy-policy")} />;
    }
    if (page === "favorites") {
      return renderToolSubpage(toolPageTitles.favorites ?? "收藏", <FavoritesPage onOpenGrammar={openGrammar} />);
    }
    if (page === "word-list") {
      return renderToolSubpage(
        toolPageTitles["word-list"] ?? "选词",
        <WordLibraryPage key={wordListLevel} initialLevel={wordListLevel} onStudyPicked={startPickedStudy} />
      );
    }
    if (page === "kanji-readings") {
      return renderToolSubpage(toolPageTitles["kanji-readings"] ?? "一字多音", <KanjiReadingUsagePage />);
    }
    if (page === "confusion") {
      return renderToolSubpage(toolPageTitles.confusion ?? "疑难辨析", <ConfusionPage />);
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
