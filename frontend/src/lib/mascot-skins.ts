export const MASCOT_SKIN_EVENT = "shushugo:mascot-skin";

export const MASCOT_SKINS = {
  "mascot-croc": {
    dir: "sheet-croc",
    names: [
      "mood-default", "mood-happy", "mood-study", "mood-idea", "mood-confused", "mood-surprised", "mood-working", "mood-love",
      "empty-box", "empty-search", "empty-network", "empty-newuser", "empty-done", "empty-bye",
      "icon-home", "icon-vocab", "icon-grammar", "icon-practice", "icon-stats", "icon-favorites", "icon-me", "icon-study-modes", "icon-kanji-readings",
      "tab-home", "tab-study", "tab-grammar", "tab-practice", "tab-stats", "tab-me",
      "logo-lockup", "scene-reading", "app-icon"
    ]
  },
  // 二次元风格主题「放学后」自带的一套图（2026-11-05 试做，ChatGPT 对话生图）：不是 mascot 槽位的商品，
  // 装备 theme-anime 且没装别的吉祥物时由 yuzu.applyYuzuEquipment 顺带套上。
  // 主角是原创美少女，这一套里**没有水豚**（用户原话「二次元理解错了，不要水豚，要美少女」）：
  // tab-* 选中格和 nav-* 是同一批物件图，tool-*-capy 藏水豚变体由 stickerUrl 退回 tool-*。
  "theme-anime": {
    dir: "sheet-anime",
    names: [
      "mood-default", "nav-home", "nav-word", "nav-grammar", "nav-profile", "tab-home", "tab-study", "tab-grammar", "tab-me",
      "tool-modes", "tool-grammar", "tool-wordlist", "tool-confusion", "tool-talk", "tool-jlpt", "tool-kanji-readings",
      "tool-favorites", "tool-vocab-test", "tool-shop", "tool-team"
    ]
  }
} as const;
