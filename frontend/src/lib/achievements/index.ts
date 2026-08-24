import { getDatabase } from "../database";
import { persistSoon, rowsFor } from "../database/db-utils";
import { ensureUserTables } from "../study-core";
import { ACHIEVEMENTS, type Achievement } from "./catalog";
import { achievementStats, type AchievementStats } from "./stats";

export type { Achievement, AchievementCategory, AchievementTier } from "./catalog";
export { ACHIEVEMENTS, CATEGORY_ORDER, TIER_LABEL } from "./catalog";

export interface AchievementView extends Achievement {
  unlocked: boolean;
  /** 解锁日期（本地日），没解锁是 null */
  unlockedOn: string | null;
  /** 当前进度值，封顶到 goal */
  progress: number;
}

/** 解锁记录存数据库而不是 Preferences —— 换设备/重装之后成就不该消失，它跟着同步走 */
const unlockedRows = (): Map<string, string> => {
  ensureUserTables();
  const map = new Map<string, string>();
  rowsFor("SELECT id, unlocked_on FROM achievements").forEach((row) => {
    map.set(String(row.id ?? ""), String(row.unlocked_on ?? ""));
  });
  return map;
};

export const unlockedAchievementIds = (): Set<string> => new Set(unlockedRows().keys());

let lastRunAt = 0;
/** 学习页每 15 秒 flush 一次都会叫一遍，别每次都扫全表 */
const THROTTLE_MS = 60_000;

/**
 * 结算成就。返回这次新解锁的那些。
 *
 * 判据全部现算，所以**装上这版就会把以前达成过的一次性补发**。
 */
const applyUnlocks = (stats: AchievementStats, unlocked: Map<string, string>): Achievement[] => {
  const pending = ACHIEVEMENTS.filter((item) => !unlocked.has(item.id));
  if (!pending.length) return [];

  const earned = pending.filter((item) => item.value(stats) >= item.goal);
  if (!earned.length) return [];

  const db = getDatabase();
  const today = new Date().toLocaleDateString("sv");   // YYYY-MM-DD，本地日
  earned.forEach((item) => {
    db.run("INSERT OR IGNORE INTO achievements (id, unlocked_on) VALUES (?, ?)", [item.id, today]);
    unlocked.set(item.id, today);
  });
  persistSoon();
  return earned;
};

export const evaluateAchievements = (options: { force?: boolean } = {}): Achievement[] => {
  const now = Date.now();
  if (!options.force && now - lastRunAt < THROTTLE_MS) return [];
  lastRunAt = now;
  return applyUnlocks(achievementStats(), unlockedRows());
};

/** 成就页要的全部内容：算一次统计，铺满整张表 */
export const achievementBoard = (): { items: AchievementView[]; unlocked: number; total: number } => {
  const unlocked = unlockedRows();
  const stats = achievementStats();
  // 打开成就页就当场结算 —— 否则会出现「进度条 8/1，却还锁着」这种自相矛盾的画面。
  // 统计对象是共用的同一个，字段都记着结果，不会因此多查一遍库。
  applyUnlocks(stats, unlocked);
  const items = ACHIEVEMENTS.map((item) => {
    const progress = Math.max(0, Math.min(item.goal, Math.floor(item.value(stats))));
    return {
      ...item,
      unlocked: unlocked.has(item.id),
      unlockedOn: unlocked.get(item.id) ?? null,
      progress
    };
  });
  return { items, unlocked: unlocked.size, total: ACHIEVEMENTS.length };
};

/**
 * 个人信息页要的一小块：只读解锁表，不算统计 —— 那边不需要进度条，别为它扫几万行。
 */
export const achievementSummary = (): { unlocked: number; total: number; recent: Achievement[] } => {
  const rows = unlockedRows();
  const byId = new Map(ACHIEVEMENTS.map((item) => [item.id, item]));
  const recent = [...rows.entries()]
    .sort((left, right) => right[1].localeCompare(left[1]))
    .map(([id]) => byId.get(id))
    .filter((item): item is Achievement => Boolean(item))
    .slice(0, 3);
  return { unlocked: rows.size, total: ACHIEVEMENTS.length, recent };
};
