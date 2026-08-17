import { firstValue, getState, persistSoon, today } from "../study-core";
import { getDatabase } from "../database";
import type { MomentKind } from "./types";

/** 播报台账的读写。表结构见 database/local-schema.sql 的 moments。 */

export const momentFired = (kind: MomentKind, key: string): boolean =>
  firstValue<number>(
    "SELECT COUNT(*) FROM moments WHERE kind = ? AND key = ?",
    [kind, String(key)],
    0
  ) > 0;

/** 今天已经播了几个,用来卡每日预算 */
export const momentsFiredOn = (day = today()): number =>
  firstValue<number>("SELECT COUNT(*) FROM moments WHERE fired_on = ?", [day], 0);

export const markMomentFired = (kind: MomentKind, key: string, day = today()): void => {
  getDatabase().run(
    "INSERT OR IGNORE INTO moments (kind, key, fired_on) VALUES (?, ?, ?)",
    [kind, String(key), day]
  );
  // 只在首页看一眼就退出的话,这一天再没有别的写库动作把它带下去 ——
  // 不落盘,刷新一次同一个时刻就又来一遍。
  persistSoon();
};

/**
 * 老库把「今天报过喜了」记在 app_state.plan_trend_seen_on,搬进 moments,
 * 否则升级当天那条报喜条会再蹦一次。
 *
 * 刻意**不删**那个老键:app_state 是 LWW 同步表,删它要写墓碑推给对端,
 * 为一个死键去惊动同步不划算。这里是 INSERT OR IGNORE,重复跑没有副作用。
 */
const LEGACY_PLAN_TREND_KEY = "plan_trend_seen_on";
let legacyMigrated = false;

export const migrateLegacyMoments = (): void => {
  if (legacyMigrated) return;
  legacyMigrated = true;
  const day = getState(LEGACY_PLAN_TREND_KEY, "");
  if (day && !momentFired("plan_trend", day)) markMomentFired("plan_trend", day, day);
};

/** 测试用:重置一次性的迁移闸 */
export const resetLegacyMigrationForTests = (): void => {
  legacyMigrated = false;
};
