import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  Brain,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  LibraryBig,
  RotateCcw,
  Search
} from "lucide-react";
import { WordStudy } from "./pages/WordStudy";
import { Library } from "./pages/Library";
import { GrammarDetail } from "./pages/GrammarDetail";
import { QuizPage } from "./pages/QuizPage";
import { GrammarReview } from "./pages/GrammarReview";
import { useStudyStore } from "./hooks/useStudyStore";
import { grammarPoints } from "./data/grammar";
import { JLPTLevel } from "./types/grammar";

type Page = "word" | "library" | "detail" | "quiz" | "review";

const APP_VIEW_STORAGE_KEY = "master-nihongo:current-view";
const validGrammarLevels = new Set<"All" | JLPTLevel>(["All", "N5", "N4", "N3", "N2", "N1"]);

const readSavedView = () => {
  try {
    const raw = localStorage.getItem(APP_VIEW_STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as Partial<{
      page: Page;
      selectedGrammarId: string;
      selectedGrammarLevel: "All" | JLPTLevel;
      sidebarCollapsed: boolean;
    }>;
    return {
      page: saved.page && navItems.some((item) => item.page === saved.page) ? saved.page : undefined,
      selectedGrammarId: typeof saved.selectedGrammarId === "string" ? saved.selectedGrammarId : undefined,
      selectedGrammarLevel:
        saved.selectedGrammarLevel && validGrammarLevels.has(saved.selectedGrammarLevel) ? saved.selectedGrammarLevel : undefined,
      sidebarCollapsed: typeof saved.sidebarCollapsed === "boolean" ? saved.sidebarCollapsed : undefined
    };
  } catch {
    return {};
  }
};

const navItems: { page: Page; label: string; icon: ReactNode }[] = [
  { page: "word", label: "单词学习", icon: <BookOpenText size={17} /> },
  { page: "quiz", label: "语法练习", icon: <Brain size={17} /> },
  { page: "review", label: "语法复习", icon: <RotateCcw size={17} /> },
  { page: "library", label: "语法学习", icon: <LibraryBig size={17} /> }
];

export default function App() {
  const store = useStudyStore();
  const [initialView] = useState(readSavedView);
  const [page, setPage] = useState<Page>(initialView.page ?? "word");
  const [selectedGrammarId, setSelectedGrammarId] = useState(initialView.selectedGrammarId ?? "wa");
  const [selectedGrammarLevel, setSelectedGrammarLevel] = useState<"All" | JLPTLevel>(initialView.selectedGrammarLevel ?? "N5");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialView.sidebarCollapsed ?? false);
  const [notice, setNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return grammarPoints
      .filter((point) => {
        const text = [
          point.title,
          point.meaning,
          point.structure,
          point.connection,
          point.explanation,
          point.level
        ].join(" ").toLowerCase();
        return text.includes(query);
      })
      .slice(0, 8);
  }, [searchQuery]);

  useEffect(() => {
    localStorage.setItem(
      APP_VIEW_STORAGE_KEY,
      JSON.stringify({ page, selectedGrammarId, selectedGrammarLevel, sidebarCollapsed })
    );
  }, [page, selectedGrammarId, selectedGrammarLevel, sidebarCollapsed]);

  const openGrammar = (id: string) => {
    setSelectedGrammarId(id);
    setPage("detail");
  };

  const chooseSearchResult = (id: string) => {
    setSearchQuery("");
    setSearchFocused(false);
    openGrammar(id);
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
    setNotice("已标记为掌握，并保存到本地进度。");
    window.setTimeout(() => setNotice(""), 1800);
  };

  const markForgotWithNotice = (id: string) => {
    store.recordReview(id, false);
    store.addToReview(id);
    setNotice("已固定到前面，稍后继续看。");
    window.setTimeout(() => setNotice(""), 1800);
  };

  const renderPage = () => {
    if (page === "word") {
      return <WordStudy />;
    }
    if (page === "library") {
      return (
        <Library
          getMastery={store.getMastery}
          onMarkLearned={markLearnedWithNotice}
          onMarkForgot={markForgotWithNotice}
          selectedLevel={selectedGrammarLevel}
          onSelectedLevelChange={setSelectedGrammarLevel}
        />
      );
    }
    if (page === "detail") {
      return (
        <GrammarDetail
          grammarId={selectedGrammarId}
          getMastery={store.getMastery}
          onBack={() => setPage("library")}
          onPractice={() => setPage("quiz")}
          onLearned={markLearnedWithNotice}
          onReview={store.addToReview}
          onMistake={addMistake}
        />
      );
    }
    if (page === "quiz") {
      return <QuizPage onMistake={addMistake} selectedLevel={selectedGrammarLevel} />;
    }
    if (page === "review") {
      return <GrammarReview selectedLevel={selectedGrammarLevel} onOpenGrammar={openGrammar} />;
    }
    return <WordStudy />;
  };

  return (
    <div className="min-h-screen bg-[#555858] text-[#fff]">
      <div className={`grid min-h-screen min-w-0 transition-[grid-template-columns] duration-200 ${sidebarCollapsed ? "lg:grid-cols-[78px_1fr]" : "lg:grid-cols-[268px_1fr]"}`}>
        <aside className={`hairline group/sidebar relative min-w-0 overflow-hidden border-b bg-[#474a4a] px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:py-6 ${sidebarCollapsed ? "lg:px-3" : "lg:px-5"}`}>
          <button
            onClick={() => setSidebarCollapsed((value) => !value)}
            className="focus-ring absolute right-[-15px] top-1/2 z-30 hidden h-11 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-[#3c3f3f] text-white opacity-0 shadow-lg transition hover:bg-[#81D8CF] hover:!text-[#343838] group-hover/sidebar:opacity-100 lg:inline-flex"
            title={sidebarCollapsed ? "展开左边栏" : "收起左边栏"}
            aria-label={sidebarCollapsed ? "展开左边栏" : "收起左边栏"}
          >
            {sidebarCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
          <div className="flex min-w-0 items-center justify-between gap-4 lg:block">
            <button
              onClick={() => setPage("word")}
              className={`focus-ring flex min-w-0 items-center rounded-md text-left ${sidebarCollapsed ? "lg:justify-center lg:gap-0" : "gap-3"}`}
            >
              <span className="grid h-11 w-11 place-items-center border border-white/20 bg-[#81D8CF] jp-serif text-xl font-bold !text-[#343838]">
                語
              </span>
              <span className={sidebarCollapsed ? "lg:hidden" : ""}>
                <span className="jp-serif block text-lg font-semibold tracking-normal text-white">
                  Master Nihongo
                </span>
                <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
                  Vocabulary · Grammar
                </span>
              </span>
            </button>
          </div>

          <div className={`relative mt-4 hidden lg:block ${sidebarCollapsed ? "lg:hidden" : ""}`}>
            <label className="relative block">
              <Search className="absolute left-3 top-2.5 text-[#81D8CF]" size={16} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchQuery("");
                    setSearchFocused(false);
                  }
                  if (event.key === "Enter" && searchResults[0]) {
                    chooseSearchResult(searchResults[0].id);
                  }
                }}
                className="focus-ring w-full rounded-md border border-white/20 bg-[#3c3f3f] py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/60"
                placeholder="文法を検索"
              />
            </label>
            {searchFocused && searchQuery.trim() && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-40 overflow-hidden rounded-md border border-white/20 bg-[#373b3b] shadow-xl">
                {searchResults.length ? (
                  searchResults.map((point) => (
                    <button
                      key={point.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseSearchResult(point.id)}
                      className="focus-ring flex w-full items-start gap-3 border-b border-white/10 px-3 py-2.5 text-left last:border-b-0 hover:bg-[#4d5151]"
                    >
                      <span className="rounded-sm bg-[#81D8CF]/20 px-2 py-1 text-[10px] font-bold text-[#81D8CF]">{point.level}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-white">{point.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-white/60">{point.meaning}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-3 text-xs font-semibold text-white/55">没有找到匹配语法</div>
                )}
              </div>
            )}
          </div>

          <nav className="mt-4 flex max-w-full gap-2 overflow-x-auto lg:mt-6 lg:flex-col lg:overflow-visible">
            {navItems.map((item) => (
              <div key={item.page} className={item.page === "quiz" ? "flex shrink-0 items-center gap-2 lg:w-full" : ""}>
                <button
                  onClick={() => setPage(item.page)}
                  className={`focus-ring inline-flex shrink-0 items-center rounded-md border px-3 py-2.5 text-sm font-semibold ${
                    sidebarCollapsed
                      ? "lg:h-11 lg:w-11 lg:justify-center lg:px-0 lg:py-0"
                      : item.page === "quiz"
                        ? "gap-2 lg:flex-1"
                        : "gap-3"
                  } ${
                    page === item.page
                      ? "border-white bg-[#81D8CF] text-[#343838]"
                      : "border-transparent text-white/78 hover:border-white/20 hover:bg-[#81D8CF]/10"
                  }`}
                >
                  {item.icon}
                  <span className={sidebarCollapsed ? "lg:hidden" : ""}>{item.label}</span>
                </button>
                {item.page === "quiz" && (
                  <select
                    value={selectedGrammarLevel}
                    onChange={(event) => {
                      setSelectedGrammarLevel(event.target.value as "All" | JLPTLevel);
                      setPage("quiz");
                    }}
                    className={`focus-ring h-9 w-[74px] rounded-md border border-white/20 bg-[#3c3f3f] px-1.5 text-xs font-bold text-white lg:h-9 lg:w-[68px] ${sidebarCollapsed ? "lg:hidden" : ""}`}
                    title="选择语法等级"
                  >
                    <option value="All">全部</option>
                    <option value="N5">N5</option>
                    <option value="N4">N4</option>
                    <option value="N3">N3</option>
                    <option value="N2">N2</option>
                    <option value="N1">N1</option>
                  </select>
                )}
              </div>
            ))}
          </nav>

          <div className={`mt-6 hidden border-t border-white/15 pt-5 text-xs leading-6 text-white/70 lg:block ${sidebarCollapsed ? "lg:hidden" : ""}`}>
            <p className="jp text-base font-semibold text-white">本日の目安</p>
            <p className="mt-2">先做单词，再进语法。</p>
            <p>语法等级：{selectedGrammarLevel === "All" ? "全部" : selectedGrammarLevel}</p>
            <p>文法は短く、毎日続ける。</p>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1400px]">{renderPage()}</div>
        </main>
      </div>
      {notice && (
        <div className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-md bg-[#81D8CF] px-4 py-3 text-sm font-semibold text-white shadow-lg">
          {notice}
        </div>
      )}
    </div>
  );
}
