import { getDatabase } from "./database";
import type { Database } from "sql.js";
import {
  ensureUserTables,
  persistSoon,
  rowsFor,
  GRAMMAR_SEED_VERSION,
  FURIGANA_VERSION
} from "./study-core";
import { GRAMMAR_HIGHLIGHTS_UPDATED_EVENT } from "./grammar-events";
export { GRAMMAR_HIGHLIGHTS_UPDATED_EVENT } from "./grammar-events";

/**
 * 这个版本号跟 grammar_seed.json 的 version 保持一致。语法内容迁移后，
 * 旧范围仍保留在库里用于跨设备合并，但不会再被当成当前内容去渲染。
 */
// grammar.ts / grammar_seed.json 重写时必须同步 bump 这里。单独的小常量避免把
// 1.3 MB 的语法正文提前拉进首屏 bundle；旧范围会因此进入失效提示而非静默消失。
export const GRAMMAR_HIGHLIGHT_DATASET_VERSION = `${GRAMMAR_SEED_VERSION}:${FURIGANA_VERSION}:2026-08-15-v3`;
export const MAX_GRAMMAR_HIGHLIGHTS = 500;
export const MAX_HIGHLIGHT_TEXT_LENGTH = 1000;

export interface GrammarHighlight {
  grammarId: string;
  block: string;
  start: number;
  end: number;
  text: string;
  datasetVersion: string;
}

export interface GrammarHighlightState {
  highlights: GrammarHighlight[];
  staleCount: number;
  totalCount: number;
}

export type GrammarHighlightWriteResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: "invalid" | "limit" | "storage" };

type CachedState = {
  all: GrammarHighlight[];
  currentVersion: string;
};

const LEGACY_STORAGE_KEY = "jp-grammar-highlights-v1";
const dbCaches = new WeakMap<object, CachedState>();
const migratedDbs = new WeakSet<object>();

const notifyChanged = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GRAMMAR_HIGHLIGHTS_UPDATED_EVENT));
  }
};

const currentDatasetVersion = (): string => GRAMMAR_HIGHLIGHT_DATASET_VERSION;

const isValid = (value: unknown): value is GrammarHighlight => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<GrammarHighlight>;
  return typeof item.grammarId === "string"
    && item.grammarId.length > 0
    && item.grammarId.length <= 200
    && typeof item.block === "string"
    && item.block.length > 0
    && item.block.length <= 200
    && Number.isSafeInteger(item.start)
    && Number.isSafeInteger(item.end)
    && Number(item.start) >= 0
    && Number(item.end) > Number(item.start)
    && Number(item.end) - Number(item.start) <= 20_000
    && typeof item.text === "string"
    && item.text.trim().length > 0
    && item.text.length <= MAX_HIGHLIGHT_TEXT_LENGTH
    && typeof item.datasetVersion === "string"
    && item.datasetVersion.length > 0
    && item.datasetVersion.length <= 200;
};

const sameRange = (left: GrammarHighlight, right: GrammarHighlight): boolean => (
  left.grammarId === right.grammarId
  && left.block === right.block
  && left.start === right.start
  && left.end === right.end
);

type GrammarHighlightRange = Pick<GrammarHighlight, "grammarId" | "block" | "start" | "end">;

const sameSurface = (left: GrammarHighlight, right: GrammarHighlight): boolean => (
  left.grammarId === right.grammarId && left.block === right.block
);

const rangesOverlap = (left: GrammarHighlightRange, right: GrammarHighlightRange): boolean => (
  left.start < right.end && right.start < left.end
);

const rowToHighlight = (row: Record<string, unknown>): GrammarHighlight => ({
  grammarId: String(row.grammar_id ?? ""),
  block: String(row.block ?? ""),
  start: Number(row.start),
  end: Number(row.end),
  text: String(row.text ?? ""),
  datasetVersion: String(row.dataset_version ?? "")
});

const removeInvalidRows = (rows: Array<Record<string, unknown>>): number => {
  const db = getDatabase();
  let removed = 0;
  rows.forEach((row) => {
    const item = rowToHighlight(row);
    if (isValid(item)) return;
    // 清理损坏/越界记录，避免坏数据永远占着配额并被同步传播。
    db.run("DELETE FROM grammar_highlights WHERE rowid = ?", [Number(row.row_id)]);
    removed += 1;
  });
  return removed;
};

const removeOverlappingRows = (rows: Array<Record<string, unknown>>, version: string): number => {
  const db = getDatabase();
  const kept: GrammarHighlight[] = [];
  let removed = 0;
  rows.forEach((row) => {
    const item = rowToHighlight(row);
    if (!isValid(item) || item.datasetVersion !== version) return;
    if (kept.some((existing) => sameSurface(existing, item) && rangesOverlap(existing, item))) {
      // 旧版本曾允许相交范围；保留最早的一条，清掉后续覆盖项，避免
      // Custom Highlight API 叠色，也不让历史数据继续占用配额。
      db.run("DELETE FROM grammar_highlights WHERE rowid = ?", [Number(row.row_id)]);
      removed += 1;
      return;
    }
    kept.push(item);
  });
  return removed;
};

const migrateLegacyHighlights = (db: Database): void => {
  if (migratedDbs.has(db)) return;
  migratedDbs.add(db);

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed) ? parsed : [];
    let migratedCount = 0;
    items.forEach((legacy) => {
      if (!legacy || typeof legacy !== "object") return;
      const value = legacy as Partial<GrammarHighlight>;
      const item: GrammarHighlight = {
        grammarId: String(value.grammarId ?? ""),
        block: String(value.block ?? ""),
        start: Number(value.start),
        end: Number(value.end),
        text: String(value.text ?? ""),
        // 旧版没有版本字段，无法证明偏移仍对应当前正文；宁可显示“失效”提示，
        // 也不把它当成当前内容的有效重点而误标。
        datasetVersion: "legacy-unversioned"
      };
      if (!isValid(item)) return;
      db.run(`
        INSERT OR IGNORE INTO grammar_highlights
          (grammar_id, block, start, end, text, dataset_version)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [item.grammarId, item.block, item.start, item.end, item.text, item.datasetVersion]);
      migratedCount += 1;
    });
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (migratedCount > 0) persistSoon();
  } catch {
    // 迁移失败时保留旧值，下一次启动仍有机会重试；当前数据库数据不受影响。
  }
};

const loadState = (): CachedState => {
  ensureUserTables();
  const db = getDatabase();
  const existing = dbCaches.get(db);
  if (existing) {
    return existing;
  }

  const version = currentDatasetVersion();
  migrateLegacyHighlights(db);
  const rawRows = rowsFor("SELECT rowid AS row_id, grammar_id, block, start, end, text, dataset_version FROM grammar_highlights");
  const invalidRemoved = removeInvalidRows(rawRows);
  const overlappingRemoved = removeOverlappingRows(rawRows, version);
  if (invalidRemoved + overlappingRemoved > 0) persistSoon();
  const cleanRows = invalidRemoved + overlappingRemoved > 0
    ? rowsFor("SELECT rowid AS row_id, grammar_id, block, start, end, text, dataset_version FROM grammar_highlights")
    : rawRows;
  const all = cleanRows.map(rowToHighlight).filter(isValid);
  const state: CachedState = { all, currentVersion: version };
  dbCaches.set(db, state);
  return state;
};

export const getGrammarHighlightState = (): GrammarHighlightState => {
  const state = loadState();
  const highlights = state.all.filter((item) => item.datasetVersion === state.currentVersion);
  return {
    highlights,
    staleCount: state.all.length - highlights.length,
    totalCount: state.all.length
  };
};

export const getGrammarHighlights = (): GrammarHighlight[] => getGrammarHighlightState().highlights;

/** 云端合并会直接写 SQLite；页面收到事件后丢掉内存快照再读一次。 */
export const invalidateGrammarHighlightCache = (): void => {
  try {
    dbCaches.delete(getDatabase());
  } catch {
    // 数据库尚未初始化时无需处理，Provider 只会在 ready 后挂载。
  }
};

export const findGrammarHighlight = (candidate: Omit<GrammarHighlight, "datasetVersion">): GrammarHighlight | undefined => {
  const state = loadState();
  return state.all.find((item) => item.datasetVersion === state.currentVersion && sameRange(item, {
    ...candidate,
    datasetVersion: state.currentVersion
  }));
};

/** 选区只要和已有重点相交，就视为“选中了重点”，不要求边界完全相同。 */
export const findGrammarHighlightsInRange = (candidate: GrammarHighlightRange): GrammarHighlight[] => {
  const state = loadState();
  return state.all.filter((item) => (
    item.datasetVersion === state.currentVersion
      && sameSurface(item, { ...candidate, text: "", datasetVersion: state.currentVersion })
      && rangesOverlap(item, candidate)
  ));
};

export const addGrammarHighlight = (
  highlight: Omit<GrammarHighlight, "datasetVersion"> & { datasetVersion?: string }
): GrammarHighlightWriteResult => {
  const state = loadState();
  const item: GrammarHighlight = {
    ...highlight,
    datasetVersion: highlight.datasetVersion ?? state.currentVersion
  };
  if (!isValid(item)) return { ok: false, reason: "invalid" };
  if (state.all.some((existing) => (
    existing.datasetVersion === item.datasetVersion
      && sameRange(existing, item)
  ))) return { ok: true, created: false };
  // 一个语法块内的状态只有“有重点/无重点”，禁止新增相交范围，避免
  // Custom Highlight API 叠加多层颜色，也让取消操作可以明确地删掉整段重点。
  if (state.all.some((existing) => (
    existing.datasetVersion === item.datasetVersion
      && sameSurface(existing, item)
      && rangesOverlap(existing, item)
  ))) return { ok: true, created: false };
  if (state.all.length >= MAX_GRAMMAR_HIGHLIGHTS) return { ok: false, reason: "limit" };

  try {
    getDatabase().run(`
      INSERT INTO grammar_highlights
        (grammar_id, block, start, end, text, dataset_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [item.grammarId, item.block, item.start, item.end, item.text, item.datasetVersion]);
    state.all.push(item);
    notifyChanged();
    persistSoon();
    return { ok: true, created: true };
  } catch {
    return { ok: false, reason: "storage" };
  }
};

export const removeGrammarHighlight = (highlight: Pick<GrammarHighlight, "grammarId" | "block" | "start" | "end">): GrammarHighlightWriteResult => {
  const state = loadState();
  const index = state.all.findIndex((item) => sameRange(item, { ...highlight, text: "", datasetVersion: state.currentVersion }));
  if (index < 0) return { ok: true, created: false };
  try {
    getDatabase().run(
      "DELETE FROM grammar_highlights WHERE grammar_id = ? AND block = ? AND start = ? AND end = ? AND dataset_version = ?",
      [highlight.grammarId, highlight.block, highlight.start, highlight.end, state.currentVersion]
    );
    state.all.splice(index, 1);
    notifyChanged();
    persistSoon();
    return { ok: true, created: false };
  } catch {
    return { ok: false, reason: "storage" };
  }
};

/**
 * 从每条相交重点中扣掉选区。选区里没有被划重点的文字不会被写入任何
 * 记录；选区只覆盖重点的一部分时，重点两侧仍然保留。
 */
export const removeGrammarHighlightsInRange = (candidate: GrammarHighlightRange): GrammarHighlightWriteResult => {
  const state = loadState();
  const matches = state.all.filter((item) => (
    item.datasetVersion === state.currentVersion
      && sameSurface(item, { ...candidate, text: "", datasetVersion: state.currentVersion })
      && rangesOverlap(item, candidate)
  ));
  if (!matches.length) return { ok: true, created: false };
  const fragments = matches.flatMap((item) => {
    const next: GrammarHighlight[] = [];
    const leftEnd = Math.min(candidate.start, item.end);
    if (item.start < leftEnd) {
      const left: GrammarHighlight = {
        ...item,
        end: leftEnd,
        text: item.text.slice(0, leftEnd - item.start)
      };
      if (isValid(left)) next.push(left);
    }
    const rightStart = Math.max(candidate.end, item.start);
    if (rightStart < item.end) {
      const right: GrammarHighlight = {
        ...item,
        start: rightStart,
        text: item.text.slice(rightStart - item.start)
      };
      if (isValid(right)) next.push(right);
    }
    return next;
  });
  try {
    const db = getDatabase();
    db.run("BEGIN TRANSACTION");
    try {
      matches.forEach((item) => db.run(
        "DELETE FROM grammar_highlights WHERE grammar_id = ? AND block = ? AND start = ? AND end = ? AND dataset_version = ?",
        [item.grammarId, item.block, item.start, item.end, item.datasetVersion]
      ));
      fragments.forEach((item) => db.run(`
        INSERT INTO grammar_highlights
          (grammar_id, block, start, end, text, dataset_version)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [item.grammarId, item.block, item.start, item.end, item.text, item.datasetVersion]));
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    const matchedKeys = new Set(matches.map((item) => `${item.start}:${item.end}`));
    state.all = state.all.filter((item) => !(
      item.datasetVersion === state.currentVersion
        && sameSurface(item, { ...candidate, text: "", datasetVersion: state.currentVersion })
        && matchedKeys.has(`${item.start}:${item.end}`)
    )).concat(fragments);
    notifyChanged();
    persistSoon();
    return { ok: true, created: false };
  } catch {
    return { ok: false, reason: "storage" };
  }
};

export const clearStaleGrammarHighlights = (): number => {
  const state = loadState();
  const stale = state.all.filter((item) => item.datasetVersion !== state.currentVersion);
  if (!stale.length) return 0;
  try {
    const db = getDatabase();
    stale.forEach((item) => db.run(
      "DELETE FROM grammar_highlights WHERE grammar_id = ? AND block = ? AND start = ? AND end = ? AND dataset_version = ?",
      [item.grammarId, item.block, item.start, item.end, item.datasetVersion]
    ));
    state.all = state.all.filter((item) => item.datasetVersion === state.currentVersion);
    notifyChanged();
    persistSoon();
    return stale.length;
  } catch {
    return 0;
  }
};

export const GRAMMAR_HIGHLIGHTS_STORAGE_KEY = "grammar_highlights";
