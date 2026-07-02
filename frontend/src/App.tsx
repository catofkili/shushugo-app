import { lazy, ReactNode, Suspense, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { WordStudy } from "./pages/WordStudy";
import { AppNavigation } from "./components/AppNavigation";
import { FillProgressModal } from "./components/FillProgressModal";
import { Paywall } from "./components/Paywall";
import { useStudyStore } from "./hooks/useStudyStore";
import { useEntitlements } from "./hooks/useEntitlements";
import { completeTodayWordPlan, getProgressOverview, markContentComplete, ProgressOverview } from "./lib/api";
import { canUseFeature, FeatureId } from "./lib/entitlements";
import { defaultStudyMode, getStudyMode, saveStudyMode } from "./lib/studyMode";
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
const HelpPage = lazy(() => import("./pages/HelpPage").then((module) => ({ default: module.HelpPage })));
const AboutPage = lazy(() => import("./pages/AboutPage").then((module) => ({ default: module.AboutPage })));
const ProPage = lazy(() => import("./pages/ProPage").then((module) => ({ default: module.ProPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const ToolboxPage = lazy(() => import("./pages/ToolboxPage").then((module) => ({ default: module.ToolboxPage })));
const StudyModesPage = lazy(() => import("./pages/StudyModesPage").then((module) => ({ default: module.StudyModesPage })));

const PageLoading = () => (
  <div className="grid min-h-48 place-items-center rounded-2xl border border-white/15 bg-[#464949] p-6 text-sm font-semibold text-white/65">
    正在加载页面...
  </div>
);

const toolPageTitles: Partial<Record<Page, string>> = {
  "study-modes": "学习模式",
  favorites: "收藏"
};

const APP_VIEW_STORAGE_KEY = "master-nihongo:current-view";
const validPages = new Set<Page>([
  "word",
  "grammar",
  "detail",
  "toolbox",
  "study-modes",
  "favorites",
  "profile",
  "pro",
  "account",
  "personal-info",
  "notifications",
  "settings",
  "privacy",
  "privacy-policy",
  "help",
  "about"
]);
const validGrammarModes = new Set<GrammarMode>(["learn", "practice", "immersive"]);
const validGrammarLevels = new Set<"All" | JLPTLevel>(["All", "N5", "N4", "N3", "N2", "N1"]);

const readSavedView = () => {
  try {
    const raw = localStorage.getItem(APP_VIEW_STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as Partial<{
      page: Page;
      grammarMode: GrammarMode;
      selectedGrammarId: string;
      selectedGrammarLevel: "All" | JLPTLevel;
      sidebarCollapsed: boolean;
    }>;
    return {
      page: saved.page && validPages.has(saved.page) ? saved.page : undefined,
      grammarMode: saved.grammarMode && validGrammarModes.has(saved.grammarMode) ? saved.grammarMode : undefined,
      selectedGrammarId: typeof saved.selectedGrammarId === "string" ? saved.selectedGrammarId : undefined,
      selectedGrammarLevel:
        saved.selectedGrammarLevel && validGrammarLevels.has(saved.selectedGrammarLevel) ? saved.selectedGrammarLevel : undefined,
      sidebarCollapsed: typeof saved.sidebarCollapsed === "boolean" ? saved.sidebarCollapsed : undefined
    };
  } catch {
    return {};
  }
};

export default function App() {
  const store = useStudyStore();
  const entitlements = useEntitlements();
  const [initialView] = useState(readSavedView);
  const [page, setPage] = useState<Page>(initialView.page ?? "word");
  const [pageHistory, setPageHistory] = useState<Page[]>([]); // 页面历史栈
  const [grammarMode, setGrammarMode] = useState<GrammarMode>(initialView.grammarMode ?? "learn");
  const [selectedGrammarId, setSelectedGrammarId] = useState(initialView.selectedGrammarId ?? "wa");
  const [selectedGrammarLevel, setSelectedGrammarLevel] = useState<"All" | JLPTLevel>(initialView.selectedGrammarLevel ?? "N5");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialView.sidebarCollapsed ?? false);
  const [notice, setNotice] = useState("");
  const [overview, setOverview] = useState<ProgressOverview>(() => getProgressOverview());
  const [fillOpen, setFillOpen] = useState(false);
  const [fillGrammarLevels, setFillGrammarLevels] = useState<JLPTLevel[]>([]);
  const [fillWordLevels, setFillWordLevels] = useState<JLPTLevel[]>([]);
  const [fillAllWords, setFillAllWords] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<FeatureId | undefined>();
  const [selectedStudyMode, setSelectedStudyMode] = useState<StudyMode>(() => getStudyMode() || defaultStudyMode);
  const [launchStudyMode, setLaunchStudyMode] = useState<StudyMode>(() => getStudyMode() || defaultStudyMode);

  useEffect(() => {
    localStorage.setItem(
      APP_VIEW_STORAGE_KEY,
      JSON.stringify({ page, grammarMode, selectedGrammarId, selectedGrammarLevel, sidebarCollapsed })
    );
  }, [page, grammarMode, selectedGrammarId, selectedGrammarLevel, sidebarCollapsed]);

  const showNotice = (message: string, timeout = 1800) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), timeout);
  };

  // 导航到新页面，记录历史
  const navigateToPage = (newPage: Page) => {
    if (newPage === "word") {
      const currentMode = getStudyMode() || defaultStudyMode;
      setSelectedStudyMode(currentMode);
      setLaunchStudyMode(currentMode);
    }
    if (newPage !== page) {
      setPageHistory([...pageHistory, page]);
      setPage(newPage);
    }
  };

  // 返回上一页
  const goBack = () => {
    if (pageHistory.length > 0) {
      const previousPage = pageHistory[pageHistory.length - 1];
      setPageHistory(pageHistory.slice(0, -1));
      setPage(previousPage);
    } else {
      setPage("word");
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

  const openGrammarTab = (mode: GrammarMode = grammarMode) => {
    setGrammarMode(mode);
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
    navigateToPage("word");
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
          className={`focus-ring soft-text-outline rounded-xl px-3 py-2 text-sm font-bold transition-all duration-300 ${grammarMode === "learn" && page !== "detail" ? "bg-[#81D8CF] !text-[#343838] shadow-[0_4px_16px_rgba(129,216,207,0.4),inset_0_1px_0_rgba(255,255,255,0.4)]" : "text-[#1f514d]/75 hover:bg-[#81D8CF]/20"}`}
        >
          学习
        </button>
        <button
          onClick={() => openGrammarTab("practice")}
          className={`focus-ring soft-text-outline rounded-xl px-3 py-2 text-sm font-bold transition-all duration-300 ${grammarMode === "practice" && page !== "detail" ? "bg-[#81D8CF] !text-[#343838] shadow-[0_4px_16px_rgba(129,216,207,0.4),inset_0_1px_0_rgba(255,255,255,0.4)]" : "text-[#1f514d]/75 hover:bg-[#81D8CF]/20"}`}
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
          onClick={() => navigateToPage("toolbox")}
          className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8 hover:text-white"
        >
          <ArrowLeft size={17} />
          工具箱
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">{title}</p>
      </div>
      {content}
    </div>
  );

  const renderPage = () => {
    if (page === "word") {
      return <WordStudy initialMode={launchStudyMode} />;
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
    if (page === "toolbox") {
      return (
        <ToolboxPage
          overview={overview}
          onNavigate={navigateToPage}
          onOpenFill={() => setFillOpen(true)}
          onRefreshOverview={refreshOverview}
          onCompleteTodayWords={completeTodayWords}
        />
      );
    }
    if (page === "profile") {
      return <ProfilePage entitlements={entitlements} onNavigate={navigateToPage} onNotice={showNotice} />;
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
      return <AccountSecurity onBack={goBack} />;
    }
    if (page === "personal-info") {
      return <PersonalInfo onBack={goBack} />;
    }
    if (page === "notifications") {
      return <NotificationSettings onBack={goBack} />;
    }
    if (page === "settings") {
      return <SettingsPage onBack={goBack} />;
    }
    if (page === "privacy") {
      return <PrivacySettings onBack={goBack} onOpenPolicy={() => navigateToPage("privacy-policy")} />;
    }
    if (page === "privacy-policy") {
      return <PrivacyPolicy onBack={goBack} />;
    }
    if (page === "help") {
      return <HelpPage onBack={goBack} />;
    }
    if (page === "about") {
      return <AboutPage onBack={goBack} />;
    }

    return <WordStudy initialMode={launchStudyMode} />;
  };

  return (
    <div className="relative h-screen overflow-hidden bg-gradient-to-br from-[#6a6d6d] via-[#7a7d7d] to-[#6a6d6d] text-[#fff]">
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
        />

        <main className="app-landscape-main fixed inset-0 min-w-0 overflow-y-auto px-4 pb-[6rem] pt-4 sm:px-6 lg:static lg:h-screen lg:overflow-y-auto lg:px-8 lg:py-8" style={{ top: 'calc(max(env(safe-area-inset-top), 54px) + 36px)', left: 0, right: 0, bottom: 'calc(max(env(safe-area-inset-bottom), 20px) + 70px)' }}>
          <div className="mx-auto max-w-[1400px]">
            <Suspense fallback={<PageLoading />}>{renderPage()}</Suspense>
          </div>
        </main>
      </div>
      {notice && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-[#81D8CF] px-4 py-3 text-sm font-semibold text-white shadow-lg lg:bottom-5">
          {notice}
        </div>
      )}
      {paywallFeature && (
        <Paywall
          feature={paywallFeature}
          onClose={() => setPaywallFeature(undefined)}
          onUnlocked={() => setPaywallFeature(undefined)}
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
    </div>
  );
}
