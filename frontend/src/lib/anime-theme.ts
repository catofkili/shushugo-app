/**
 * 风格主题「放学后」（theme-anime，2026-11-05）：原创美少女 + TV 动画设定稿式平涂，主题里一只水豚都没有。
 * 规则和来龙去脉见 docs/claude/interface-and-design-system.md 末节，样式在 src/skins-anime.css，图在 public/brand/sheet-anime/。
 *
 * ⚠️ 为什么商品和贴纸表都写在这里、不进 yuzu-catalog.ts / mascot-skins.ts：那两份小程序也打包，
 *    写进去主包就超 1,900,000 B 上限（实测超 520 B）。这份只被网页版 CapybaraMascot.tsx 引入，
 *    小程序那边 CapybaraMascot 换成了 mascot.weapp.tsx，这个文件根本进不去 —— 小程序商店里自然没有这件。
 *    网页上买了、同步到小程序：账本里有这行但小程序不认识这个商品，界面照旧是默认外观，不会坏。
 */
import { YUZU_ITEMS, type YuzuItem } from "./yuzu-catalog";

export const ANIME_THEME_ID = "theme-anime";

/** 同名贴纸：tab-* 是 nav-* 的拷贝（AppNavigation 装了皮肤后选中格读 tab-*），tool-*-capy 由 stickerUrl 退回 tool-* */
export const ANIME_SHEET = {
  dir: "sheet-anime",
  names: [
    "mood-default", "nav-home", "nav-word", "nav-grammar", "nav-profile", "tab-home", "tab-study", "tab-grammar", "tab-me",
    "tool-modes", "tool-grammar", "tool-wordlist", "tool-confusion", "tool-talk", "tool-jlpt", "tool-kanji-readings",
    "tool-favorites", "tool-vocab-test", "tool-shop", "tool-team"
  ]
} as const;

const ITEM: YuzuItem = { id: ANIME_THEME_ID, name: "放学后", description: "二次元画风：原创女主、平涂插画、教室窗外的天空", category: "theme", price: 3000 };
// 排在两件「质感主题」（纸本 / 圆圆）后面
if (!YUZU_ITEMS.some((item) => item.id === ANIME_THEME_ID)) {
  YUZU_ITEMS.splice(YUZU_ITEMS.findIndex((item) => item.id === "theme-round") + 1, 0, ITEM);
}
