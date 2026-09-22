/**
 * 收集日的吉祥物：全部是作者的原图（`public/brand/sheet/`），不是画的。
 * 表情 / 功能图标 / Tab / 空状态 / Logo / 启动页来自 2026-09-19 晚补的五张高清分图（一格约 300px，
 * `scripts/brand-sheet/cut-hires.sh`）；满足、加油、一字多音、工具盘更多图标、气泡、每日一句、走路帧
 * 只有定妆总表上有（一格约 100px，`cut-v2.sh` 双三次放大 3~4 倍）。换图同名替换即可，代码不用改。
 *
 * 裁图坐标在 scratchpad 的 cut-all.sh 里（面板底色按四边泛洪抠掉）；总表本身在 ~/收集日/。
 *
 * mood 对应总表「表情 / 情绪状态」那一排：
 *   default 默认 · happy 开心 · content 满足 · study 学习中 · idea 灵感 · fight 加油
 *   confused 疑惑 · surprised 惊讶 · working 努力中 · love 喜欢
 * 空状态 / 提示插画走 <Sticker name="empty-…">，那一排是整张画不是表情。
 */
import type React from "react";
import { useSyncExternalStore } from "react";

export type MascotMood =
  | "default" | "happy" | "content" | "study" | "idea" | "fight" | "confused" | "surprised" | "working" | "love";

export type StickerName =
  | `mood-${MascotMood}`
  | "empty-box" | "empty-search" | "empty-network" | "empty-newuser" | "empty-done" | "empty-bye"
  | "icon-home" | "icon-vocab" | "icon-grammar" | "icon-practice" | "icon-stats" | "icon-favorites" | "icon-me"
  | "icon-study-modes" | "icon-kanji-readings"
  | "tool-notebook" | "tool-speak" | "tool-listen" | "tool-kana" | "tool-review" | "tool-plan" | "tool-night" | "tool-settings" | "tool-delete" | "tool-share" | "tool-download" | "tool-more"
  | "tab-home" | "tab-study" | "tab-grammar" | "tab-practice" | "tab-stats" | "tab-me"
  | "bubble-cheer" | "bubble-great" | "bubble-more" | "card-daily"
  | "logo-lockup" | "splash-sleep" | "quote-splash" | "scene-onsen" | "scene-reading" | "decor-set"
  | "walk-frame";

/**
 * 吉祥物皮肤（柚子商店 mascot 槽位）。每套皮肤是 `public/brand/sheet-<皮肤>/` 下**同名**的一批贴纸，
 * 由 `scripts/brand-sheet/cut-<皮肤>.sh` 从作者的分图裁出来。
 * 皮肤没有的那一格退回默认那套（工具盘小图标、气泡、走路帧鳄鱼那套没有 —— 小路上走的仍是水豚）；
 * 表情缺的退回**这套皮肤的默认表情**，不能退回水豚：一屏里两种动物比少一个表情糟得多。
 */
const SKIN_SHEETS: Record<string, { dir: string; names: ReadonlySet<string> }> = {
  "mascot-croc": {
    dir: "sheet-croc",
    names: new Set([
      "mood-default", "mood-happy", "mood-study", "mood-idea", "mood-confused", "mood-surprised", "mood-working", "mood-love",
      "empty-box", "empty-search", "empty-network", "empty-newuser", "empty-done", "empty-bye",
      "icon-home", "icon-vocab", "icon-grammar", "icon-practice", "icon-stats", "icon-favorites", "icon-me", "icon-study-modes", "icon-kanji-readings",
      "tab-home", "tab-study", "tab-grammar", "tab-practice", "tab-stats", "tab-me",
      "logo-lockup", "scene-reading", "app-icon"
    ])
  }
};
let skin = "";
export const MASCOT_SKIN_EVENT = "shushugo:mascot-skin";
/** yuzu.applyYuzuEquipment 调：装备哪个 mascot 商品（'' = 默认水豚） */
export const setMascotSkin = (itemId: string) => {
  if (skin === itemId) return;
  skin = itemId;
  window.dispatchEvent(new Event(MASCOT_SKIN_EVENT));
};
const subscribe = (cb: () => void) => { window.addEventListener(MASCOT_SKIN_EVENT, cb); return () => window.removeEventListener(MASCOT_SKIN_EVENT, cb); };
/** 组件里拿当前皮肤，皮肤一换所有贴纸同一帧重画 */
export const useMascotSkin = () => useSyncExternalStore(subscribe, () => skin, () => "");

export const stickerUrl = (name: StickerName, skinId = skin) => {
  const sheet = SKIN_SHEETS[skinId];
  if (!sheet) return `/brand/sheet/${name}.png`;
  if (sheet.names.has(name)) return `/brand/${sheet.dir}/${name}.png`;
  if (name.startsWith("mood-")) return `/brand/${sheet.dir}/mood-default.png`;
  return `/brand/sheet/${name}.png`;
};
/** 问候条 / 导航栏那枚品牌图标：皮肤自带 App 图标就用皮肤的 */
export const brandIconUrl = (skinId = skin) => (SKIN_SHEETS[skinId] ? `/brand/${SKIN_SHEETS[skinId].dir}/app-icon.png` : "/brand/shushugo-icon.png");

/** 总表上的任意一格。size 是高度，宽度按原图比例走（空状态那排不是正方形）。 */
export function Sticker({ name, size = 96, className = "", alt = "" }: { name: StickerName; size?: number; className?: string; alt?: string }) {
  const current = useMascotSkin();
  return <img src={stickerUrl(name, current)} alt={alt} style={{ height: size, width: "auto" }} className={className} draggable={false} />;
}
/** 品牌图标 <img>，跟着皮肤走 */
export function BrandIcon({ className = "", alt = "" }: { className?: string; alt?: string }) {
  const current = useMascotSkin();
  return <img src={brandIconUrl(current)} alt={alt} className={className} />;
}

export function CapybaraMascot({ size = 96, mood = "default", className = "" }: { size?: number; mood?: MascotMood; className?: string }) {
  return <Sticker name={`mood-${mood}`} size={size} className={className} alt="收集日吉祥物" />;
}

/**
 * walk-frame 是 walk-strip 的第一帧（sips 裁的），给商店当商品图用。
 * 走路的那只：四帧拼成一条 sprite（`walk-strip.png`，格子 248×272），CSS steps(4) 翻帧。
 * 顶栏小路和页面加载都用它；尺寸按高度给，宽度按格子比例算。
 */
export function CapybaraWalk({ size = 55, className = "" }: { size?: number; className?: string }) {
  const w = Math.round((size * 248) / 272);
  return (
    <span
      className={`mascot-walk ${className}`}
      aria-hidden="true"
      style={{ "--cell": `${w}px`, width: w, height: size, backgroundSize: `${w * 4}px ${size}px` } as React.CSSProperties}
    />
  );
}
