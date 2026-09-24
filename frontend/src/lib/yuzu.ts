/**
 * 柚子:免费货币。只奖「做完了」,绝不奖「答得好」——
 * 和答对/答错挂钩的那一刻,用户就会为了钱点「认识」,喂给 FSRS 的全是假数据。
 *
 * 数字是拿作者 102 天真实流水回放定的(见 CLAUDE.md「柚子」一节):
 * 奖励和商店价格同时乘 10，保持攒到首件主题所需的学习时间不变。
 */
import { getDatabase } from "./database";
import { firstValue, persistSoon, rowsFor, getState, setState, today } from "./database/db-utils";
import { stage1ProgressCounts } from "./word-api/stage1";
import { readEncoreLog } from "./review-budget";
import { computeStreak, shiftDay } from "./zoo-streak";
import { setSoundTimbre, type SoundTimbre } from "./zoo-sounds";
import { setMascotSkin } from "../components/CapybaraMascot";
import { getEntitlements } from "./entitlements";
import { EQUIPPABLE, itemById, VOICE_ITEM_PREFIX, type YuzuCategory } from "./yuzu-catalog";

export const YUZU = {
  /** 今天学了 ≥ 100 个词。计划排得太大清不完的日子(作者 7~8 月有 25 天)也该有份 */
  study: 50,
  studyWords: 100,
  /** 今日计划清完,叠在 study 之上 → 一天 100 */
  plan: 50,
  /** 连击每满 7 天 */
  streak7: 300,
  /** 加餐,一天一次 */
  encore: 50,
  achievement: 200,
  /** 补签:30 天内第 1/2/3 张,再往后按最后一档 */
  repair: [500, 1000, 2000],
  /** 只补 7 天以内的洞 */
  repairWindowDays: 7
} as const;

export const YUZU_EVENT = "shushugo:yuzu";
const ensureYuzuScale = (): void => {
  if (getState("yuzu_scale_10", "") === "1") return;
  const db = getDatabase();
  db.run("BEGIN");
  try {
    if (getState("yuzu_scale_10", "") !== "1") {
      db.run("UPDATE yuzu_ledger SET amount = amount * 10 WHERE amount != 0");
      setState("yuzu_scale_10", "1");
    }
    db.run("COMMIT");
    persistSoon();
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
};
const emit = () => {
  applyYuzuEquipment();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(YUZU_EVENT));
};

/**
 * 把装备落到运行时:配色写 <html data-skin>(CSS 按属性换 --zoo-* 变量),
 * 音色交给 zoo-sounds,吉祥物皮肤交给 CapybaraMascot 的贴纸表。启动时(库就位后)和每次买 / 换装备都调一次。
 */
export const applyYuzuEquipment = (): void => {
  if (typeof document === "undefined") return;
  try {
    const skin = equippedItem("theme");
    if (skin) document.documentElement.setAttribute("data-skin", skin);
    else document.documentElement.removeAttribute("data-skin");
    setSoundTimbre((equippedItem("sound").replace("sound-", "") || "kalimba") as SoundTimbre);
    setMascotSkin(equippedItem("mascot"));
  } catch { /* 表还没建出来(老库第一次启动) */ }
};

/** 声音下拉能不能选这个:默认那个免费,别的要买过 `voice-<id>` */
export const voiceUnlocked = (voiceId: string, defaultId: string | null): boolean =>
  !voiceId || voiceId === defaultId || ownsItem(VOICE_ITEM_PREFIX + voiceId);

const book = (kind: string, key: string, amount: number): boolean => {
  getDatabase().run("INSERT OR IGNORE INTO yuzu_ledger (kind, key, amount, day) VALUES (?, ?, ?, ?)", [kind, key, amount, today()]);
  return firstValue<number>("SELECT changes()", [], 0) > 0;
};

export const yuzuBalance = (): number => {
  ensureYuzuScale();
  return firstValue<number>("SELECT COALESCE(SUM(amount), 0) FROM yuzu_ledger", [], 0);
};

/** 今天记了哪几笔,商店页头部列出来 */
export const yuzuToday = () => {
  ensureYuzuScale();
  return rowsFor("SELECT kind, key, amount FROM yuzu_ledger WHERE day = ? ORDER BY rowid", [today()])
    .map((row) => ({ kind: String(row.kind), key: String(row.key), amount: Number(row.amount) }));
};

/**
 * 结算今天的收入。幂等,学习页每次 flush 都可以叫。
 * 成就那一笔不挂在解锁事件上,而是对着 achievements 表补差 —— 补发的老成就也拿得到。
 */
export const settleYuzu = (): number => {
  ensureYuzuScale();
  const day = today();
  let earned = 0;
  const words = firstValue<number>(
    "SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ? AND direction = 'forward'", [day], 0);
  if (words >= YUZU.studyWords && book("study", day, YUZU.study)) earned += YUZU.study;
  const plan = stage1ProgressCounts();
  if (plan.total > 0 && plan.completed >= plan.total && book("plan", day, YUZU.plan)) earned += YUZU.plan;
  const checkins = rowsFor("SELECT checked_on FROM checkins").map((row) => String(row.checked_on));
  const streak = computeStreak(checkins, day);
  if (checkins.includes(day) && streak > 0 && streak % 7 === 0 && book("streak", day, YUZU.streak7)) earned += YUZU.streak7;
  if (readEncoreLog(day).dayWords > 0 && book("encore", day, YUZU.encore)) earned += YUZU.encore;
  rowsFor("SELECT id FROM achievements WHERE id NOT IN (SELECT key FROM yuzu_ledger WHERE kind = 'achievement')")
    .forEach((row) => { if (book("achievement", String(row.id), YUZU.achievement)) earned += YUZU.achievement; });
  const gifted = proGiftEligible() && grantRepairCard("pro", false);
  if (earned || gifted) { persistSoon(); emit(); }
  return earned;
};

export const ownsItem = (id: string): boolean =>
  firstValue<number>("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'buy' AND key = ?", [id], 0) > 0;

export const buyItem = (id: string): boolean => {
  const item = itemById(id);
  if (!item || item.soon || ownsItem(id) || yuzuBalance() < item.price) return false;
  book("buy", id, -item.price);
  if (EQUIPPABLE.has(item.category) && !equippedItem(item.category)) equipItem(id);
  persistSoon(); emit();
  return true;
};

const equipKey = (category: YuzuCategory) => `yuzu_equipped:${category}`;
/** 当前装备的商品 id,'' = 默认 */
export const equippedItem = (category: YuzuCategory): string => getState(equipKey(category), "");
export const equipItem = (id: string): void => {
  const item = itemById(id);
  if (!item || !EQUIPPABLE.has(item.category) || !ownsItem(id)) return;
  setState(equipKey(item.category), id);
  persistSoon(); emit();
};
export const unequip = (category: YuzuCategory): void => { setState(equipKey(category), ""); persistSoon(); emit(); };

/** 补签价:30 天内已经补过几次 */
export const repairPrice = (): number => {
  ensureYuzuScale();
  const since = shiftDay(today(), -30);
  const used = firstValue<number>("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('repair', 'card_buy') AND day >= ?", [since], 0);
  return YUZU.repair[Math.min(used, YUZU.repair.length - 1)];
};

/** 最近 7 天里断掉的日子(不含今天),最近的在前。第一次打卡之前的日子不算洞 */
export const repairableDays = (): string[] => {
  const day = today();
  const set = new Set(rowsFor("SELECT checked_on FROM checkins").map((row) => String(row.checked_on)));
  const first = [...set].sort()[0];
  if (!first) return [];
  const out: string[] = [];
  for (let i = 1; i <= YUZU.repairWindowDays; i++) {
    const d = shiftDay(day, -i);
    if (d > first && !set.has(d)) out.push(d);
  }
  return out;
};

/** 补签卡记 `card` 或付费购买 `card_buy`；使用时记 `repair_card`。 */
export const repairCards = (): number => Math.max(0,
  firstValue<number>("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_buy')", [], 0)
  - firstValue<number>("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'repair_card'", [], 0));

export const grantRepairCard = (key: string, notify = true): boolean => {
  if (firstValue<number>("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_overflow') AND key = ?", [key], 0)) return false;
  if (repairCards() >= 1) return false;
  const booked = book("card", key, 0);
  if (booked && notify) { persistSoon(); emit(); }
  return booked;
};

export const buyRepairCard = (): boolean => {
  if (repairCards() >= 1) return false;
  const price = repairPrice();
  if (yuzuBalance() < price) return false;
  const key = `${today()}:${firstValue<number>("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'card_buy' AND day = ?", [today()], 0) + 1}`;
  if (!book("card_buy", key, -price)) return false;
  persistSoon(); emit();
  return true;
};

/**
 * 开通 Pro 送一张,每个账号一次(key 固定 'pro',账本跨设备同步)。
 * 试用不算「开通」:试用一次送一张的话,到期前退掉再开就是白拿。
 */
export const proGiftEligible = (): boolean => {
  try {
    const ent = getEntitlements();
    return ent.isPro && ent.source !== "trial";
  } catch { return false; }
};
export const proGiftClaimed = (): boolean =>
  firstValue<number>("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_overflow') AND key = 'pro'", [], 0) > 0;

export const repairDayWithCard = (day: string): boolean => {
  if (!repairableDays().includes(day) || repairCards() < 1) return false;
  book("repair_card", day, 0);
  getDatabase().run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)", [day]);
  persistSoon(); emit();
  return true;
};

export const repairDay = (day: string): boolean => {
  if (!repairableDays().includes(day)) return false;
  const price = repairPrice();
  if (yuzuBalance() < price) return false;
  const db = getDatabase();
  book("repair", day, -price);
  db.run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)", [day]);
  persistSoon(); emit();
  return true;
};
