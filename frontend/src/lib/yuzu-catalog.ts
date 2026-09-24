/**
 * 柚子商店的货架。全是数字商品,买断、不消耗。
 *
 * 图放 `public/brand/shop/<id>.png`,没有图的先用占位块(作者统一出图后同名放进去即可)。
 * `category` 里 theme / mascot / icon / sound 是「装备一件」的槽位；声音沿用学习偏好里的
 * voiceId，商店和设置页写的是同一份选择，避免出现两个互相打架的“当前声音”。
 *
 * 已接线:theme(styles.css 的 [data-skin])、mascot(CapybaraMascot 的贴纸表)、
 * voice(speech.resolveVoice + 设置页)、sound(zoo-sounds 音色)。
 * `soon` 的还没做(icon 要 Capacitor 换图标插件、misc 三件等图),货架上露脸但不卖。
 */
import type { StickerName } from "../components/CapybaraMascot";

export type YuzuCategory = "theme" | "mascot" | "icon" | "voice" | "sound" | "misc";

/** 声音商品的 id 形如 voice-<音频库里的 voice id>,买了哪个设置页就能选哪个 */
export const VOICE_ITEM_PREFIX = "voice-";

export interface YuzuItem {
  id: string;
  name: string;
  description: string;
  category: YuzuCategory;
  price: number;
  /** 还没做出来(等图 / 等插件):货架上露脸但不卖,免得有人花柚子买到一个空壳 */
  soon?: true;
  /** 商品图用总表上哪一格(见 CapybaraMascot 的 StickerName)。配色主题不用图,现场画色板;皮肤用那套皮肤的默认表情 */
  art?: StickerName;
}

export const CATEGORY_LABEL: Record<YuzuCategory, string> = {
  theme: "配色主题",
  mascot: "吉祥物皮肤",
  icon: "App 图标",
  voice: "发音声音",
  sound: "答题音效",
  misc: "其它"
};

/** 买了要「使用」才生效的槽位 */
export const EQUIPPABLE: ReadonlySet<YuzuCategory> = new Set(["theme", "mascot", "icon", "sound"]);

export const YUZU_ITEMS: YuzuItem[] = [
  { id: "theme-matcha", name: "抹茶", description: "青绿主色换成抹茶绿", category: "theme", price: 2000 },
  { id: "theme-sakura", name: "樱", description: "粉底樱色", category: "theme", price: 2000 },
  { id: "theme-night", name: "深夜食堂", description: "暗琥珀暖调的夜间配色", category: "theme", price: 2000 },
  // 下面两件不只换颜色，还换质感（投影、边框、按钮、字体），样式在 skins.css
  { id: "theme-paper", name: "纸本", description: "奶油纸色、墨色主键、细线分隔，像一本安静的单词本", category: "theme", price: 3000 },
  { id: "theme-round", name: "圆圆", description: "白底圆体、会按下去的立体按钮、柚子橙点缀", category: "theme", price: 3000 },
  { id: "mascot-croc", name: "鳄鱼", description: "换一只鳄鱼:表情、页面图标、空状态插画整套换。小路上走的还是水豚", category: "mascot", price: 3000 },
  { id: "icon-happy", name: "开心图标", description: "把 App 图标换成开心表情", category: "icon", price: 5000, soon: true, art: "mood-happy" },
  { id: "icon-study", name: "读书图标", description: "把 App 图标换成读书表情", category: "icon", price: 5000, soon: true, art: "mood-study" },
  { id: "voice-voicevox-10", name: "雨晴はう", description: "轻快女声。切换单词发音；例句仍用默认声", category: "voice", price: 6000, art: "tool-speak" },
  { id: "voice-voicevox-11", name: "玄野武宏", description: "沉稳男声。切换单词发音；例句仍用默认声", category: "voice", price: 6000, art: "tool-listen" },
  { id: "sound-marimba", name: "木琴", description: "答题音换成木琴:更圆、更短", category: "sound", price: 3000, art: "bubble-great" },
  { id: "sound-epiano", name: "电钢", description: "答题音换成电钢:带一点毛边的暖音", category: "sound", price: 3000, art: "bubble-cheer" },
  { id: "walk-alt", name: "小路走法", description: "学习页小路上换一套走路动画", category: "misc", price: 4000, soon: true, art: "walk-frame" },
  { id: "report-cover", name: "周报封面", description: "周报封面换一张", category: "misc", price: 3000, soon: true, art: "card-daily" },
  { id: "team-title", name: "队伍称号", description: "队伍称号页名字旁的专属称号", category: "misc", price: 3000, soon: true, art: "decor-set" }
];

export const itemById = (id: string) => YUZU_ITEMS.find((item) => item.id === id);
