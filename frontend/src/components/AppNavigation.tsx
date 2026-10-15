import { useEffect, useState, type TouchEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Sticker, type StickerName, BrandIcon, useMascotSkin } from "./CapybaraMascot";
import type { JLPTLevel } from "../types/grammar";
import type { Page, StudyMode } from "../types/app";
import type { SearchResult } from "../lib/search-api";
import { getGrammarTitleFurigana } from "../lib/grammar-title-furigana";
import { JapaneseRuby } from "./JapaneseRuby";
import { SquirrelTrail } from "./SquirrelTrail";
import { mobileTitles } from "../app/navigation-titles";
import { scrollPageToTop } from "../lib/touch-adapter";
export { mobileTitles } from "../app/navigation-titles";

// 主页取代了原来的「工具箱」：工具箱的学习模式、收藏、进度概览等入口都挪到了主页。
// 图标（2026-10-14 v3，作者定的方案 A）：没选中的格只画物件（nav-*），选中那格是水豚抱着这格的物件（nav-*-capy）——
// 底栏永远只有一只水豚，跟着用户走。作者原话「水豚当然应该是主角」，所以选中格不许也换成纯物件。
// 装了皮肤时选中格用皮肤自己的 tab-*（鳄鱼那套有），不然一屏里冒出两种动物。
const navItems: { page: Page; label: string; skinIcon: StickerName; object: StickerName; capy: StickerName }[] = [
  { page: "home", label: "主页", skinIcon: "tab-home", object: "nav-home", capy: "nav-home-capy" },
  { page: "word", label: "单词学习", skinIcon: "tab-study", object: "nav-word", capy: "nav-word-capy" },
  { page: "grammar", label: "语法", skinIcon: "tab-grammar", object: "nav-grammar", capy: "nav-grammar-capy" },
  { page: "profile", label: "我的", skinIcon: "tab-me", object: "nav-profile", capy: "nav-profile-capy" }
];

const isGrammarPage = (page: Page) => page === "grammar" || page === "detail";
// 组队/学习模式/收藏都是从主页的格子进去的，导航上仍高亮「主页」。
// 2026-10-15：「我的」下面的子页同理高亮「我的」。底栏方案 A 里选中格才画水豚，一格都不亮 = 底栏零水豚（作者：水豚是主角）。
const isHomePage = (page: Page) =>
  ["home", "team", "duel", "quick-study", "vocab-test", "talk", "jlpt-practice", "grammar-foundation", "favorites", "distinction-quiz", "yuzu-shop",
    "confusion", "kanji-readings", "word-list", "jlpt-plan", "streak", "weekly-report"].includes(page);
const isProfilePage = (page: Page) =>
  ["profile", "pro", "account", "personal-info", "notifications", "settings", "privacy", "privacy-policy", "user-agreement", "help", "achievements", "about"].includes(page);
const isRootMobilePage = (page: Page) => ["home", "word", "grammar", "profile"].includes(page);

// 手机顶栏的标题。页面里各自那条「← 返回 | 标题」(.page-backbar) 在手机上藏掉，
// 返回和标题只由顶栏说一次 —— 以前子页面是两个返回键、同一个标题说两三遍。
// null = 页面自己有大标题(h1)，顶栏只留返回键，免得标题叠两层。
interface AppNavigationProps {
  page: Page;
  sidebarCollapsed: boolean;
  selectedGrammarLevel: "All" | JLPTLevel;
  onBack: () => void;
  onNavigate: (page: Page) => void;
  onOpenGrammarTab: () => void;
  onSearchResult: (result: SearchResult) => void;
  onToggleSidebar: () => void;
  /** 当前正在哪个模式里学习(不在学习页就是 null)：小路按模式换成对应的进度 */
  studyMode?: StudyMode | null;
}

export function AppNavigation({
  page,
  sidebarCollapsed,
  selectedGrammarLevel,
  onBack,
  onNavigate,
  onOpenGrammarTab,
  onSearchResult,
  onToggleSidebar,
  studyMode = null
}: AppNavigationProps) {
  const skin = useMascotSkin();
  const tabIcon = (item: typeof navItems[number], active: boolean) => !active ? item.object : skin ? item.skinIcon : item.capy;
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
    target === "grammar" ? isGrammarPage(page)
      : target === "home" ? isHomePage(page)
      : target === "profile" ? isProfilePage(page)
      : page === target
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
        className="app-mobile-topbar app-landscape-topbar fixed left-0 right-0 top-0 z-10 px-4 pb-2 pt-[calc(max(env(safe-area-inset-top),54px)+0.4rem)] backdrop-blur-[30px] lg:hidden"
        style={{ touchAction: "none", pointerEvents: "auto" }}
        onTouchMove={(event) => event.preventDefault()}
      >
        <div className="app-topbar-row">
          {!isRootMobilePage(page) && (
            <button onClick={onBack} className="focus-ring app-topbar-back" aria-label="返回">
              <ArrowLeft size={20} />
            </button>
          )}

          {page === "word" ? (
            // 小路只在学习页出现：它说的是「这一趟走到哪」，别的页面上它是重复主页大卡的那个数
            <SquirrelTrail mode={studyMode} />
          ) : page === "home" ? (
            <span className="app-topbar-brand">
              <span className="jp-serif">收集日<i className="brand-sprout" aria-hidden="true" /></span>
            </span>
          ) : (
            <h1 className="app-topbar-title">{mobileTitles[page] ?? ""}</h1>
          )}
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
            onClick={() => onNavigate("home")}
            className={`focus-ring flex min-w-0 items-center rounded-2xl text-left ${sidebarCollapsed ? "lg:justify-center lg:gap-0" : "gap-3"}`}
          >
            <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-xl border border-white/30 bg-[#C08552] shadow-lg">
              <BrandIcon className="brand-icon h-full w-full object-cover" />
            </span>
            <span className={sidebarCollapsed ? "lg:hidden" : ""}>
              <span className="jp-serif block text-lg font-semibold tracking-normal text-white">
                收集日<i className="brand-sprout" aria-hidden="true" />
              </span>
              <span className="block text-[11px] font-semibold text-white/65">
                收集每一个更好的自己
              </span>
            </span>
          </button>
        </div>

        {/* 手机端的小路在顶栏,桌面端顶栏是隐藏的,所以侧栏这儿也放一条,免得大屏看不到今天走到哪 */}
        <div className={`mt-4 hidden lg:flex ${sidebarCollapsed ? "lg:hidden" : ""}`}>
          <SquirrelTrail mode={studyMode} />
        </div>

        <div className={`relative mt-3 hidden lg:block ${sidebarCollapsed ? "lg:hidden" : ""}`}>
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
                    <span className="mt-0.5 rounded-lg bg-[#81D8CF]/18 px-2 py-1 text-[11px] font-black text-[#81D8CF]">
                      {result.type === "word" ? "词" : "文"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">
                        {result.type === "grammar"
                          ? <JapaneseRuby text={result.title} furigana={getGrammarTitleFurigana(result.id)} />
                          : result.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-white/58">{result.subtitle}</span>
                      <span className="mt-0.5 block truncate text-[11px] font-bold uppercase text-white/40">{result.meta}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="flex items-center gap-2 px-3 py-3 text-xs font-semibold text-white/55"><Sticker name="empty-search" size={34} />没有找到相关内容，换个关键词试试吧</div>
              )}
            </div>
          )}
        </div>

        <nav className="mt-6 flex flex-col gap-2">
          {navItems.map((item) => {
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
                  <Sticker name={tabIcon(item, active)} size={20} className={active ? "" : "opacity-80"} />
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

      {/* 四个 Tab 以前各是一个描边+投影+填色的按钮，选中的那个是整块实心色 ——
          底栏本身成了全屏最重的东西。现在不画框：选中只靠图标底下一小块浅色和文字变色。 */}
      <nav
        onTouchMove={handleNavTouchMove}
        className="app-mobile-tabbar app-landscape-rail fixed bottom-0 left-0 right-0 z-[9999] px-1 pb-[calc(max(env(safe-area-inset-bottom),20px)*0.5+0.25rem)] pt-1 lg:hidden"
      >
        <div className="app-landscape-rail-grid grid grid-cols-4">
          {navItems.map((item) => {
            const active = isActive(item.page);
            return (
              <button
                key={item.page}
                onClick={(event) => {
                  const icon = event.currentTarget.querySelector<HTMLElement>(".app-tab-icon");
                  // 只有真的在这个根页面上才是「再点一下」（晃 + 回顶）；子页上这格也亮着，点它是回根页面。
                  // 原来写的是 if (active)，从主页进的子页点「主页」只晃不走。
                  if (page === item.page) {
                    if (Capacitor.getPlatform() === "wechat") return;
                    if (icon) {
                      icon.classList.remove("ds-tab-rock", "ds-tab-bump");
                      void icon.clientWidth;
                      icon.classList.add("ds-tab-rock");
                      window.setTimeout(() => icon.classList.remove("ds-tab-rock"), 360);
                    }
                    scrollPageToTop();
                    return;
                  }
                  if (icon) {
                    icon.classList.remove("ds-tab-bump");
                    void icon.clientWidth;
                    icon.classList.add("ds-tab-bump");
                    window.setTimeout(() => icon.classList.remove("ds-tab-bump"), 240);
                  }
                  openNavPage(item.page);
                }}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`focus-ring app-tab${active ? " is-active" : ""}`}
              >
                <span className="app-tab-pill">
                  <Sticker name={tabIcon(item, active)} size={30} className={`app-tab-icon${active ? " is-active" : ""}`} />
                </span>
                <span className="app-tab-label">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
