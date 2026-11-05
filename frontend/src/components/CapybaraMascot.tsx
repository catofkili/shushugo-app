/**
 * 收集日的吉祥物：全部是作者的原图（`public/brand/sheet/`），不是画的。
 * 表情 / 功能图标 / Tab / 空状态 / Logo / 启动页来自 2026-09-19 晚补的五张高清分图（一格约 300px，
 * `scripts/brand-sheet/cut-hires.sh`）；2026-09-23 又补了四张表情分图（20 格，`cut-extra.sh`）；满足、加油、一字多音、工具盘更多图标、气泡、每日一句、走路帧
 * 只有定妆总表上有（一格约 100px，`cut-v2.sh` 双三次放大 3~4 倍）。换图同名替换即可，代码不用改。
 *
 * 裁图坐标在 scratchpad 的 cut-all.sh 里（面板底色按四边泛洪抠掉）；总表本身在 ~/收集日/。
 *
 * mood 对应总表「表情 / 情绪状态」那一排：
 *   default 默认 · happy 开心 · content 满足 · study 学习中 · idea 灵感 · fight 加油
 *   confused 疑惑 · surprised 惊讶 · working 努力中 · love 喜欢
 * 空状态 / 提示插画走 <Sticker name="empty-…">，那一排是整张画不是表情。
 */
import { useSyncExternalStore, type CSSProperties } from "react";
import { MASCOT_SKIN_EVENT, MASCOT_SKINS } from "../lib/mascot-skins";
import { ANIME_SHEET, ANIME_THEME_ID } from "../lib/anime-theme";
export { MASCOT_SKIN_EVENT };

export type MascotMood =
  | "default" | "happy" | "content" | "study" | "idea" | "fight" | "confused" | "surprised" | "working" | "love"
  // 2026-09-23 晚补的四张分图（cut-extra.sh）：生病 饿了 欢呼 头晕 挥手 / 惊吓 害羞 抱心 想不通 得意 /
  // 大哭 生气 想问 睡着 耶 / 攥拳。鳄鱼皮肤没有这些，按下面的规则退回鳄鱼默认表情。
  | "sick" | "hungry" | "cheer" | "dizzy" | "wave" | "shocked" | "shy" | "heart" | "puzzled" | "proud"
  | "cry" | "angry" | "ask" | "sleep" | "yay" | "fired-up";

export type StickerName =
  | `mood-${MascotMood}`
  | "empty-box" | "empty-search" | "empty-network" | "empty-newuser" | "empty-done" | "empty-bye"
  | "icon-home" | "icon-vocab" | "icon-grammar" | "icon-practice" | "icon-stats" | "icon-favorites" | "icon-me"
  | "icon-study-modes" | "icon-kanji-readings"
  | "tool-notebook" | "tool-speak" | "tool-listen" | "tool-kana" | "tool-review" | "tool-plan" | "tool-night" | "tool-settings" | "tool-delete" | "tool-share" | "tool-download" | "tool-more"
  | "tab-home" | "tab-study" | "tab-grammar" | "tab-practice" | "tab-stats" | "tab-me"
  | "bubble-cheer" | "bubble-great" | "bubble-more" | "card-daily"
  | "logo-lockup" | "splash-sleep" | "quote-splash" | "scene-onsen" | "scene-reading" | "decor-set"
  | "scene-laptop" | "scene-music" | "scene-book" | "scene-stretch"
  | "walk-frame"
  // 2026-09-24 那批（scripts/brand-sheet/cut-0924.sh）：组队头图 8 张、商店商品图、首页三格新图标
  | "icon-shop" | "icon-kanji-choice"
  | "scene-team" | "scene-team-2" | "scene-team-3" | "scene-team-4" | "scene-team-5" | "scene-team-6" | "scene-team-7" | "scene-team-8"
  | "item-repair" | "item-repair-card" | "item-repair-write" | "item-repair-cheer"
  | "item-voice-male" | "item-voice-male-2" | "item-voice-female" | "item-voice-female-2"
  | "item-sound-epiano" | "item-sound-epiano-2" | "item-sound-marimba" | "item-sound-marimba-2"
  | "roll-frame"
  // 2026-10-14 前端 v3（docs/FRONTEND_V3_PLAN.md §1.1 / §1.3）：功能入口一律用物件插画，不画吉祥物。
  // 作者放开了生成：这批是 GPT 以上面原图为参考生成的，同一画风、无文字、透明底。
  | "tool-modes" | "tool-grammar" | "tool-wordlist" | "tool-confusion" | "tool-talk" | "tool-jlpt"
  | "tool-kanji-readings" | "tool-favorites" | "tool-vocab-test" | "tool-shop" | "tool-team"
  | "tool-modes-capy" | "tool-grammar-capy" | "tool-wordlist-capy" | "tool-confusion-capy" | "tool-talk-capy" | "tool-jlpt-capy"
  | "tool-kanji-readings-capy" | "tool-favorites-capy" | "tool-vocab-test-capy" | "tool-shop-capy" | "tool-team-capy"
  // 底栏（方案 A）：没选中 = 物件，选中 = 水豚抱物件。见 AppNavigation 的 navItems
  | "nav-home" | "nav-word" | "nav-grammar" | "nav-profile"
  | "nav-home-capy" | "nav-word-capy" | "nav-grammar-capy" | "nav-profile-capy"
  // 2026-10-15 v3：模式物件、组队徽章、连胜皇冠和柚子币。
  | "mode-classic" | "mode-mixed" | "mode-mistakes" | "mode-quick" | "mode-reverse" | "mode-kanji" | "mode-picked"
  | "emblem-sprout" | "emblem-squirrel" | "emblem-bird" | "emblem-train" | "emblem-owl" | "emblem-yuzu" | "emblem-books" | "emblem-torii"
  | "crown" | "yuzu-coin"
  // 2026-10-19 柚子商店备用 App 图标的缩略图：真图标（GPT 生成）压成 320px、iOS 圆角烘进 PNG（透明角）
  | "app-icon-happy" | "app-icon-onsen";

/**
 * 吉祥物皮肤（柚子商店 mascot 槽位）。每套皮肤是 `public/brand/sheet-<皮肤>/` 下**同名**的一批贴纸，
 * 由 `scripts/brand-sheet/cut-<皮肤>.sh` 从作者的分图裁出来。
 * 皮肤没有的那一格退回默认那套（工具盘小图标、气泡、走路帧鳄鱼那套没有 —— 小路上走的仍是水豚）；
 * 表情缺的退回**这套皮肤的默认表情**，不能退回水豚：一屏里两种动物比少一个表情糟得多。
 */
const SKIN_SHEETS: Record<string, { dir: string; names: ReadonlySet<string> }> = Object.fromEntries(
  [...Object.entries(MASCOT_SKINS), [ANIME_THEME_ID, ANIME_SHEET] as const].map(([id, sheet]) => [id, { dir: sheet.dir, names: new Set<string>(sheet.names) }])
);
export const prepareMascotSkins = async (): Promise<void> => {};
export const mascotSkinReady = (id: string): boolean => id in SKIN_SHEETS;
let skin = "";
/** yuzu.applyYuzuEquipment 调：装备哪个 mascot 商品（'' = 默认水豚） */
/** 启动闪屏读这一格：读库之前还不知道装了什么，所以每次换皮肤都把「皮肤的默认表情」图址记进 localStorage，
 *  index.html 的静态闪屏和 main.tsx 的读库闪屏拿它代替睡觉的水豚（放学后主题要求一只水豚都不出现，2026-11-05） */
// ⚠️ 键名在 main.tsx 和 index.html 里各写了一份字面量：不从这里 import，是因为小程序的替身
//    mascot.weapp.tsx 没有这个导出（verify-shim-exports 会拦），而小程序根本不跑 main.tsx，不值得给主包加字节
const SPLASH_STICKER_KEY = "shushugo:splash-sticker";
export const setMascotSkin = (itemId: string) => {
  // 主题自带一套贴纸（放学后）、又没装吉祥物皮肤时，用主题那套。yuzu.applyYuzuEquipment 先写 <html data-skin> 再调这里，
  // 所以这里读得到刚换上的主题。不在 yuzu.ts 里做：那份小程序也打包，主包没地方（见 lib/anime-theme.ts 开头）
  const theme = typeof document === "undefined" ? "" : document.documentElement.getAttribute("data-skin") ?? "";
  if (!itemId && theme in SKIN_SHEETS && !(theme in MASCOT_SKINS)) itemId = theme;
  // 写在提前返回之前：别的设备卸了皮肤同步过来时 skin 已经是 ''，也要把旧记录清掉
  try {
    if (itemId) localStorage.setItem(SPLASH_STICKER_KEY, stickerUrl("mood-default", itemId));
    else localStorage.removeItem(SPLASH_STICKER_KEY);
  } catch { /* 隐私模式等拿不到 localStorage 就照旧画水豚 */ }
  if (skin === itemId) return;
  skin = itemId;
  window.dispatchEvent(new Event(MASCOT_SKIN_EVENT));
};
const subscribe = (cb: () => void) => { window.addEventListener(MASCOT_SKIN_EVENT, cb); return () => window.removeEventListener(MASCOT_SKIN_EVENT, cb); };
/** 组件里拿当前皮肤，皮肤一换所有贴纸同一帧重画 */
export const useMascotSkin = () => useSyncExternalStore(subscribe, () => skin, () => "");

const WALK_STYLE_EVENT = "shushugo:walk-style";
let walkStyle = "";
/** 走法独立于皮肤；装备变化时所有已挂载的走路组件同步重画。 */
export const setWalkStyle = (itemId: string) => {
  const next = itemId === "walk-alt" ? itemId : "";
  if (walkStyle === next) return;
  walkStyle = next;
  window.dispatchEvent(new Event(WALK_STYLE_EVENT));
};
const subscribeWalkStyle = (callback: () => void) => {
  window.addEventListener(WALK_STYLE_EVENT, callback);
  return () => window.removeEventListener(WALK_STYLE_EVENT, callback);
};
export const useWalkStyle = () => useSyncExternalStore(subscribeWalkStyle, () => walkStyle, () => "");

export const brandAssetUrl = (path: string) => `${import.meta.env.BASE_URL}brand/${path}`;

export const stickerUrl = (name: StickerName, skinId = skin) => {
  const sheet = SKIN_SHEETS[skinId];
  if (!sheet) return brandAssetUrl(`sheet/${name}.png`);
  if (sheet.names.has(name)) return brandAssetUrl(`${sheet.dir}/${name}.png`);
  // 「藏水豚」变体（tool-*-capy 等）：皮肤有本体就用本体 —— 不然换了皮肤，工具格里会随机冒出原画水豚
  const base = name.endsWith("-capy") ? name.slice(0, -5) : "";
  if (base && sheet.names.has(base)) return brandAssetUrl(`${sheet.dir}/${base}.png`);
  // scene-*（主页大卡按时段换的那几张）、empty-*（空状态）同理：皮肤没画就用皮肤的默认表情，不退回水豚原图
  // （2026-11-05 补，以前鳄鱼皮肤主页大卡会冒出水豚；放学后主题的查词汇量 / 辨析练习空状态同理）
  if (/^(mood|scene|empty)-/.test(name)) return brandAssetUrl(`${sheet.dir}/mood-default.png`);
  return brandAssetUrl(`sheet/${name}.png`);
};
/** 问候条 / 导航栏那枚品牌图标：皮肤自带 App 图标就用皮肤的 */
export const brandIconUrl = (skinId = skin) => brandAssetUrl(SKIN_SHEETS[skinId]?.names.has("app-icon") ? `${SKIN_SHEETS[skinId].dir}/app-icon.png` : "shushugo-icon.png");

/** 总表上的任意一格。size 是高度，宽度按原图比例走（空状态那排不是正方形）。 */
export function Sticker({ name, size = 96, className = "", alt = "" }: { name: StickerName; size?: number; className?: string; alt?: string }) {
  const current = useMascotSkin();
  return <img src={stickerUrl(name, current)} alt={alt} style={{ height: size, width: "auto" }} className={className} draggable={false} />;
}
/** 品牌图标 <img>，跟着皮肤走 */
export function BrandIcon({ className = "", alt = "" }: { className?: string; alt?: string }) {
  const current = useMascotSkin();
  return <span className={`brand-icon-pair ${className}`}>
    <img src={brandIconUrl(current)} alt={alt} className="brand-icon-light" />
    <img src={brandAssetUrl("shushugo-icon-dark.png")} alt={alt} className="brand-icon-dark" />
  </span>;
}

export function CapybaraMascot({ size = 96, mood = "default", className = "" }: { size?: number; mood?: MascotMood; className?: string }) {
  return <Sticker name={`mood-${mood}`} size={size} className={className} alt="收集日吉祥物" />;
}

/**
 * walk-frame 是 walk-strip 的第一帧（sips 裁的），给商店当商品图用。
 * 默认走路四帧（248:272），滚着走八帧（545:334）；按帧数设置 steps 和时长。
 * 顶栏小路和页面加载都用它；尺寸按高度给，宽度按格子比例算。
 */
export function CapybaraWalk({ size = 55, className = "" }: { size?: number; className?: string }) {
  const rolling = useWalkStyle() === "walk-alt";
  const frames = rolling ? 8 : 4;
  const w = Math.round(size * (rolling ? 545 / 334 : 248 / 272));
  return (
    <span
      className={`mascot-walk ${className}`}
      aria-hidden="true"
      style={{ width: w, height: size, "--walk-frames": frames, "--walk-duration": `${frames * 160}ms` } as CSSProperties}
    >
      <img className="mascot-walk-strip" src={brandAssetUrl(rolling ? "sheet/roll-strip.png" : "sheet/walk-strip.png")} alt="" style={{ width: w * frames, height: size }} />
    </span>
  );
}
