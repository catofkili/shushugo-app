import type { JLPTLevel } from "../types/grammar";
import { grammarPoints } from "../data/grammar";
import { getDatabase } from "./database";
import { ensureUserTables, persistSoon, rowsFor } from "./study-core";
import { GRAMMAR_POSITIONS_UPDATED_EVENT } from "./grammar-events";
export { GRAMMAR_POSITIONS_UPDATED_EVENT } from "./grammar-events";

export type GrammarPositionKind = "library" | "immersive";
export type GrammarPositionLevel = "All" | JLPTLevel;

// 仅用于从上一版 localStorage 迁移；新写入全部进入 SQLite 并随同步快照走。
export const GRAMMAR_POSITION_STORAGE_KEY = "jp-grammar-reading-position-v1";

const migratedDbs = new WeakSet<object>();

const notifyChanged = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GRAMMAR_POSITIONS_UPDATED_EVENT));
  }
};

const validLevel = (value: string): value is GrammarPositionLevel => (
  value === "All" || value === "N1" || value === "N2" || value === "N3" || value === "N4" || value === "N5"
);

const pointIdAtIndex = (level: GrammarPositionLevel, index: number): string | undefined => {
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  const points = grammarPoints.filter((point) => level === "All" || point.level === level);
  return points[index]?.id;
};

const migrateLegacyPositions = (db: object): void => {
  if (migratedDbs.has(db)) return;
  migratedDbs.add(db);

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(GRAMMAR_POSITION_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as { library?: Record<string, unknown>; immersive?: Record<string, unknown> };
    const library = parsed.library && typeof parsed.library === "object" ? parsed.library : {};
    const immersive = parsed.immersive && typeof parsed.immersive === "object" ? parsed.immersive : {};
    Object.entries(library).forEach(([level, value]) => {
      if (!validLevel(level) || typeof value !== "string" || !value) return;
      dbValueInsert(level, "library", value);
    });
    Object.entries(immersive).forEach(([level, value]) => {
      if (!validLevel(level)) return;
      const index = Number(value);
      const pointId = typeof value === "string" ? value : pointIdAtIndex(level, index);
      if (pointId) dbValueInsert(level, "immersive", pointId);
    });
    localStorage.removeItem(GRAMMAR_POSITION_STORAGE_KEY);
    persistSoon();
  } catch {
    // 保留旧值，下一次启动继续尝试迁移。
  }
};

const dbValueInsert = (level: string, kind: GrammarPositionKind, grammarId: string): void => {
  getDatabase().run(`
    INSERT INTO grammar_reading_positions (kind, level, grammar_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(kind, level) DO UPDATE SET
      grammar_id = excluded.grammar_id,
      updated_at = excluded.updated_at
  `, [kind, level, grammarId]);
};

const prepare = (): void => {
  ensureUserTables();
  const db = getDatabase();
  migrateLegacyPositions(db);
};

export const getGrammarPosition = (
  kind: GrammarPositionKind,
  level: GrammarPositionLevel
): string | undefined => {
  prepare();
  const row = rowsFor(
    "SELECT grammar_id FROM grammar_reading_positions WHERE kind = ? AND level = ? LIMIT 1",
    [kind, level]
  )[0];
  return typeof row?.grammar_id === "string" && row.grammar_id ? row.grammar_id : undefined;
};

export const saveGrammarPosition = (
  kind: GrammarPositionKind,
  level: GrammarPositionLevel,
  grammarId: string
): boolean => {
  prepare();
  if (!grammarId.trim()) return false;
  try {
    dbValueInsert(level, kind, grammarId);
    notifyChanged();
    persistSoon();
    return true;
  } catch {
    return false;
  }
};

export const getGrammarScrollPosition = (
  kind: GrammarPositionKind,
  level: GrammarPositionLevel
): number | undefined => {
  prepare();
  const row = rowsFor(
    "SELECT scroll_top FROM grammar_reading_positions WHERE kind = ? AND level = ? LIMIT 1",
    [kind, level]
  )[0];
  const value = Number(row?.scroll_top);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

/** Save the scroll offset belonging to the already-selected grammar card. */
export const saveGrammarScrollPosition = (
  kind: GrammarPositionKind,
  level: GrammarPositionLevel,
  scrollTop: number
): boolean => {
  prepare();
  const value = Number(scrollTop);
  if (!Number.isFinite(value) || value < 0) return false;
  try {
    const changed = rowsFor(
      "SELECT grammar_id FROM grammar_reading_positions WHERE kind = ? AND level = ? LIMIT 1",
      [kind, level]
    )[0];
    if (!changed?.grammar_id) return false;
    getDatabase().run(`
      UPDATE grammar_reading_positions
      SET scroll_top = ?, updated_at = CURRENT_TIMESTAMP
      WHERE kind = ? AND level = ?
    `, [value, kind, level]);
    persistSoon();
    notifyChanged();
    return true;
  } catch {
    return false;
  }
};
