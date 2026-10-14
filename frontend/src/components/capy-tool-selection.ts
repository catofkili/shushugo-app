import type { StickerName } from "./CapybaraMascot";

export const CAPY_TOOL_ICONS: StickerName[] = [
  "tool-modes", "tool-grammar", "tool-wordlist", "tool-confusion", "tool-talk", "tool-jlpt",
  "tool-kanji-readings", "tool-favorites", "tool-vocab-test", "tool-shop", "tool-team"
];

export const pickCapyTools = (random = Math.random): Set<StickerName> => {
  const count = Math.floor(random() * 3);
  const icons = [...CAPY_TOOL_ICONS];
  for (let index = icons.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [icons[index], icons[swap]] = [icons[swap], icons[index]];
  }
  return new Set(icons.slice(0, count));
};
