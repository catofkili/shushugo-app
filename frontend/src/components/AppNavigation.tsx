import { useEffect, useState, type TouchEvent } from "react";
import {
  ArrowLeft,
  BookOpenText,
  Brain,
  ChevronLeft,
  ChevronRight,
  LucideIcon,
  Search,
  UserRound,
  Wrench
} from "lucide-react";
import type { JLPTLevel } from "../types/grammar";
import type { Page } from "../types/app";
import type { SearchResult } from "../lib/search-api";

const navItems: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: "word", label: "单词学习", icon: BookOpenText },
  { page: "grammar", label: "语法", icon: Brain },
  { page: "toolbox", label: "工具箱", icon: Wrench },
  { page: "profile", label: "我的", icon: UserRound }
];

const isGrammarPage = (page: Page) => page === "grammar" || page === "detail";
const isToolboxPage = (page: Page) => ["toolbox", "study-modes", "favorites"].includes(page);
const isRootMobilePage = (page: Page) => ["word", "grammar", "toolbox", "profile"].includes(page);

interface AppNavigationProps {
  page: Page;
  sidebarCollapsed: boolean;
  selectedGrammarLevel: "All" | JLPTLevel;
  onBack: () => void;
  onNavigate: (page: Page) => void;
  onOpenGrammarTab: () => void;
  onSearchResult: (result: SearchResult) => void;
  onToggleSidebar: () => void;
}

export function AppNavigation({
  page,
  sidebarCollapsed,
  selectedGrammarLevel,
  onBack,
  onNavigate,
  onOpenGrammarTab,
  onSearchResult,
  onToggleSidebar
}: AppNavigationProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    let active = true;
    import("../lib/search-api")
      .then(({ searchContent }) => {
        if (active) setSearchResults(searchContent(query, 8));
      })
      .catch(() => {
        if (active) setSearchResults([]);
      });

    return () => {
      active = false;
    };
  }, [searchQuery]);

  const openNavPage = (target: Page) => {
    if (target === "grammar") {
      onOpenGrammarTab();
      return;
    }
    onNavigate(target);
  };

  const isActive = (target: Page) => (
    target === "grammar" ? isGrammarPage(page) : target === "toolbox" ? isToolboxPage(page) : page === target
  );

  const handleNavTouchMove = (event: TouchEvent) => {
    event.preventDefault();
  };

  const chooseSearchResult = (result: SearchResult) => {
    onSearchResult(result);
    setSearchQuery("");
    setSearchFocused(false);
  };

  return (
    <>
      <div
        className="app-mobile-topbar app-landscape-topbar fixed left-0 right-0 top-0 z-10 bg-white/15 px-4 pb-2 pt-[calc(max(env(safe-area-inset-top),54px)+0.4rem)] backdrop-blur-[30px] lg:hidden"
        style={{
          touchAction: "none",
          pointerEvents: "auto",
          transition: "transform 0.3s ease-out",
          transform: "translateY(0)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.25)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)"
        }}
        onTouchMove={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between gap-3">
          {!isRootMobilePage(page) ? (
            <button
              onClick={onBack}
              className="focus-ring inline-flex items-center gap-2 rounded-xl px-2 py-1 text-sm font-bold text-white/78 hover:bg-[#81D8CF]/15 hover:text-white"
            >
              <ArrowLeft size={18} />
            </button>
          ) : (
            <div className="w-9" />
          )}

          <button
            onClick={() => onNavigate("word")}
            className="focus-ring rounded-xl px-1 text-left"
          >
            <span className="jp-serif block text-base font-semibold leading-none tracking-wide text-white">
              Master
            </span>
          </button>
        </div>
      </div>

      <aside
        className={`hairline group/sidebar relative hidden min-w-0 overflow-hidden lg:sticky lg:top-0 lg:block lg:h-screen lg:border-r lg:border-white/15 lg:py-6 ${sidebarCollapsed ? "lg:px-3" : "lg:px-5"}`}
        style={{
          background: "rgba(255, 255, 255, 0.15)",
          backdropFilter: "blur(30px) saturate(200%)",
          WebkitBackdropFilter: "blur(30px) saturate(200%)"
        }}
      >
        <button
          onClick={onToggleSidebar}
          className="focus-ring absolute right-[-15px] top-1/2 z-30 hidden h-11 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white opacity-0 shadow-lg backdrop-blur-xl transition hover:bg-[#81D8CF] hover:!text-[#343838] group-hover/sidebar:opacity-100 lg:inline-flex"
          title={sidebarCollapsed ? "展开左边栏" : "收起左边栏"}
          aria-label={sidebarCollapsed ? "展开左边栏" : "收起左边栏"}
        >
          {sidebarCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>

        <div className="flex min-w-0 items-center justify-between gap-4 lg:block">
          <button
            onClick={() => onNavigate("word")}
            className={`focus-ring flex min-w-0 items-center rounded-2xl text-left ${sidebarCollapsed ? "lg:justify-center lg:gap-0" : "gap-3"}`}
          >
            <span className="jp-serif grid h-11 w-11 place-items-center rounded-xl border border-white/30 bg-[#81D8CF] text-xl font-bold !text-[#343838] shadow-lg">
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
          <label className="focus-ring control-cyan control-cyan-search soft-text-outline flex rounded-2xl border px-3 py-2">
            <Search className="control-cyan-icon shrink-0" size={16} />
            <input
              className="control-cyan-search-input text-sm font-semibold"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchQuery("");
                  setSearchFocused(false);
                }
                if (event.key === "Enter" && searchResults[0]) {
                  chooseSearchResult(searchResults[0]);
                }
              }}
              placeholder="語彙・文法を検索"
            />
          </label>
          {searchFocused && searchQuery.trim() && (
            <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-40 overflow-hidden rounded-2xl border border-white/20 bg-[#464949] shadow-2xl">
              {searchResults.length ? (
                searchResults.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseSearchResult(result)}
                    className="focus-ring flex w-full items-start gap-3 border-b border-white/10 px-3 py-2.5 text-left last:border-b-0 hover:bg-[#4f5353]"
                  >
                    <span className="mt-0.5 rounded-lg bg-[#81D8CF]/18 px-2 py-1 text-[10px] font-black text-[#81D8CF]">
                      {result.type === "word" ? "词" : "文"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">{result.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-white/58">{result.subtitle}</span>
                      <span className="mt-0.5 block truncate text-[10px] font-bold uppercase text-white/40">{result.meta}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-xs font-semibold text-white/55">没有找到匹配内容</div>
              )}
            </div>
          )}
        </div>

        <nav className="mt-6 flex flex-col gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.page);
            return (
              <div key={item.page}>
                <button
                  onClick={() => openNavPage(item.page)}
                  className={`focus-ring inline-flex shrink-0 items-center rounded-2xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                    sidebarCollapsed ? "lg:h-11 lg:w-11 lg:justify-center lg:px-0 lg:py-0" : "gap-3"
                  } ${
                    active
                      ? "border-white/30 bg-[#81D8CF] text-[#343838] shadow-lg"
                      : "border-transparent text-white/78 backdrop-blur-xl hover:border-white/20 hover:bg-[#81D8CF]/15"
                  }`}
                >
                  <Icon size={17} />
                  <span className={sidebarCollapsed ? "lg:hidden" : ""}>{item.label}</span>
                </button>
              </div>
            );
          })}
        </nav>

        <div className={`mt-6 hidden border-t border-white/15 pt-5 text-xs leading-6 text-white/70 lg:block ${sidebarCollapsed ? "lg:hidden" : ""}`}>
          <p className="jp text-base font-semibold text-white">本日の目安</p>
          <p className="mt-2">先做单词，再进语法。</p>
          <p>语法等级：{selectedGrammarLevel === "All" ? "全部" : selectedGrammarLevel}</p>
          <p>文法は短く、毎日続ける。</p>
        </div>
      </aside>

      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          backgroundColor: "rgba(255, 255, 255, 0.15)",
          backdropFilter: "blur(30px) saturate(200%)",
          WebkitBackdropFilter: "blur(30px) saturate(200%)",
          transition: "transform 0.3s ease-out",
          transform: "translateY(0)",
          borderTop: "1px solid rgba(255, 255, 255, 0.25)",
          boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.1)"
        }}
        onTouchMove={handleNavTouchMove}
        className="app-mobile-tabbar app-landscape-rail px-1 pb-[calc(max(env(safe-area-inset-bottom),20px)*0.5+0.25rem)] pt-1 lg:hidden"
      >
        <div className="app-landscape-rail-grid grid grid-cols-4 gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.page);
            return (
              <button
                key={item.page}
                onClick={() => openNavPage(item.page)}
                className={`focus-ring flex h-[54px] min-w-0 flex-col items-center justify-center rounded-2xl border px-0.5 transition-all duration-300 ${
                  active
                    ? "border-white/30 bg-[#81D8CF] text-[#343838] shadow-[0_6px_20px_rgba(129,216,207,0.4),inset_0_1px_0_rgba(255,255,255,0.4)]"
                    : "border-white/18 bg-white/8 text-white/76 shadow-[0_4px_12px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-white/12"
                }`}
              >
                <Icon size={24} strokeWidth={active ? 2.6 : 2.2} />
                <span className="mt-0.5 whitespace-nowrap text-[11px] font-bold leading-none tracking-normal">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
