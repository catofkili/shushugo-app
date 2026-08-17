import type { Database } from "sql.js";
import { getDatabase } from "./database";
import { firstRow, firstValue, getState, persistSoon, rowsFor, setState } from "./database/db-utils";

const LEGACY_BIRU_ID = 2480;
const CANONICAL_BIRU_ID = 775;
const LEGACY_BIRU_MIGRATION_VERSION = "2026-08-13-biru-2480-to-775-v1";
const MIGRATION_STATE_KEY = "legacy_biru_merge_version";

const tableExists = (table: string): boolean => firstValue<number>(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  [table],
  0
) === 1;

const columnsOf = (table: string): string[] => rowsFor(`PRAGMA table_info(${table})`)
  .map((row) => String(row.name ?? ""))
  .filter(Boolean);

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const rowExists = (table: string, wordId: number, extraWhere = "", params: Array<string | number> = []): boolean => (
  firstValue<number>(
    `SELECT 1 FROM ${quoteIdentifier(table)} WHERE word_id = ?${extraWhere} LIMIT 1`,
    [wordId, ...params],
    0
  ) === 1
);

/**
 * 把旧 id 的一行复制到正式 id，再显式删除旧行。
 * 显式 DELETE 很重要：同步触发器会为 2480 写墓碑，避免另一台设备把旧行复活。
 */
const replaceSingleRow = (
  db: Database,
  table: string,
  preferLegacy: boolean,
  extraWhere = "",
  params: Array<string | number> = []
): void => {
  if (!tableExists(table) || !rowExists(table, LEGACY_BIRU_ID, extraWhere, params)) return;
  const canonicalExists = rowExists(table, CANONICAL_BIRU_ID, extraWhere, params);
  if (!canonicalExists || preferLegacy) {
    if (canonicalExists) {
      db.run(`DELETE FROM ${quoteIdentifier(table)} WHERE word_id = ?${extraWhere}`, [CANONICAL_BIRU_ID, ...params]);
    }
    const columns = columnsOf(table).filter((column) => (
      column !== "sync_updated_at" && column !== "sync_origin_device"
    ));
    const selectColumns = columns.map((column) => (
      column === "word_id" ? "?" : quoteIdentifier(column)
    ));
    db.run(
      `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})
       SELECT ${selectColumns.join(", ")}
       FROM ${quoteIdentifier(table)}
       WHERE word_id = ?${extraWhere}`,
      [CANONICAL_BIRU_ID, LEGACY_BIRU_ID, ...params]
    );
  }
  db.run(`DELETE FROM ${quoteIdentifier(table)} WHERE word_id = ?${extraWhere}`, [LEGACY_BIRU_ID, ...params]);
};

const migrateDatedRows = (db: Database, table: string, preferLegacy: boolean): void => {
  if (!tableExists(table)) return;
  const dates = rowsFor(
    `SELECT reviewed_on FROM ${quoteIdentifier(table)} WHERE word_id = ? ORDER BY reviewed_on`,
    [LEGACY_BIRU_ID]
  );
  dates.forEach((row) => {
    replaceSingleRow(db, table, preferLegacy, " AND reviewed_on = ?", [String(row.reviewed_on ?? "")]);
  });
};

const rewriteQueue = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return raw;
    const byWord = new Map<number, Record<string, unknown>>();
    parsed.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const record = item as Record<string, unknown>;
      const originalId = Number(record.word_id);
      const wordId = originalId === LEGACY_BIRU_ID ? CANONICAL_BIRU_ID : originalId;
      if (!Number.isFinite(wordId)) return;
      const next: Record<string, unknown> = { ...record, word_id: wordId };
      const existing = byWord.get(wordId);
      if (!existing || Number(next.due_after ?? 0) < Number(existing.due_after ?? 0)) byWord.set(wordId, next);
    });
    return JSON.stringify([...byWord.values()]);
  } catch {
    return raw;
  }
};

const rewriteWordIdsDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(rewriteWordIdsDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    key === "word_id" && Number(item) === LEGACY_BIRU_ID
      ? CANONICAL_BIRU_ID
      : rewriteWordIdsDeep(item)
  ]));
};

const rewriteJsonState = (key: string): void => {
  const raw = getState(key, "");
  if (!raw) return;
  try {
    setState(key, JSON.stringify(rewriteWordIdsDeep(JSON.parse(raw))));
  } catch {
    // 不是合法 JSON 就保持原样；这些键下一次正常作答会自行覆盖。
  }
};

const migrateSessionState = (): void => {
  ["review_queue", "review_queue_reverse", "review_queue_kanji"].forEach((key) => {
    const raw = getState(key, "");
    if (raw) setState(key, rewriteQueue(raw));
  });
  ["current_card", "last_answered_word", "last_answered_word_reverse", "last_answered_word_kanji"].forEach((key) => {
    if (Number(getState(key, "0")) === LEGACY_BIRU_ID) setState(key, String(CANONICAL_BIRU_ID));
  });
  ["last_answer", "undo_pinned_card"].forEach(rewriteJsonState);
};

export interface LegacyBiruMigrationReport {
  migrated: boolean;
  winnerId: number;
  canonicalSeenCount: number;
  legacySeenCount: number;
  movedReviews: number;
}

export const legacyBiruMigrationNeeded = (): boolean => (
  getState(MIGRATION_STATE_KEY, "") !== LEGACY_BIRU_MIGRATION_VERSION
  && firstValue<number>("SELECT 1 FROM words WHERE id = ? LIMIT 1", [LEGACY_BIRU_ID], 0) === 1
  && firstValue<number>("SELECT 1 FROM words WHERE id = ? LIMIT 1", [CANONICAL_BIRU_ID], 0) === 1
);

/** 合并旧词 ビル(2480) 到正式词条 building/ビル(775)。 */
export function migrateLegacyBiruDuplicate(): LegacyBiruMigrationReport {
  const db = getDatabase();
  const canonical = firstRow("SELECT * FROM progress WHERE word_id = ?", [CANONICAL_BIRU_ID]);
  const legacy = firstRow("SELECT * FROM progress WHERE word_id = ?", [LEGACY_BIRU_ID]);
  const canonicalSeenCount = Number(canonical?.seen_count ?? 0);
  const legacySeenCount = Number(legacy?.seen_count ?? 0);
  const preferLegacy = legacySeenCount > canonicalSeenCount;
  const winnerId = preferLegacy ? LEGACY_BIRU_ID : CANONICAL_BIRU_ID;
  const movedReviews = tableExists("reviews")
    ? firstValue<number>("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [LEGACY_BIRU_ID], 0)
    : 0;

  if (!legacyBiruMigrationNeeded()) {
    return { migrated: false, winnerId, canonicalSeenCount, legacySeenCount, movedReviews: 0 };
  }

  db.run("BEGIN TRANSACTION");
  try {
    // 三个方向的长期状态各自按点击次数较多的一行取胜；正向 winner 同时决定便签和当天任务冲突。
    replaceSingleRow(db, "progress", preferLegacy);
    ["reverse_memory", "kanji_memory"].forEach((table) => {
      if (!tableExists(table)) return;
      const keepClicks = firstValue<number>(
        `SELECT COALESCE(seen_count, 0) FROM ${quoteIdentifier(table)} WHERE word_id = ?`,
        [CANONICAL_BIRU_ID],
        0
      );
      const dropClicks = firstValue<number>(
        `SELECT COALESCE(seen_count, 0) FROM ${quoteIdentifier(table)} WHERE word_id = ?`,
        [LEGACY_BIRU_ID],
        0
      );
      replaceSingleRow(db, table, dropClicks > keepClicks);
    });

    ["stage1_tasks", "stage2_progress", "kanji_progress", "critical_reviews"].forEach((table) => {
      migrateDatedRows(db, table, preferLegacy);
    });
    replaceSingleRow(db, "word_notes", preferLegacy || !rowExists("word_notes", CANONICAL_BIRU_ID));
    replaceSingleRow(db, "moji_migrated_reviews", preferLegacy || !rowExists("moji_migrated_reviews", CANONICAL_BIRU_ID));

    if (tableExists("reviews")) db.run("UPDATE reviews SET word_id = ? WHERE word_id = ?", [CANONICAL_BIRU_ID, LEGACY_BIRU_ID]);
    if (tableExists("content_favorites")) {
      db.run(`
        INSERT OR IGNORE INTO content_favorites (item_type, item_id)
        SELECT item_type, ? FROM content_favorites
        WHERE item_type = 'word' AND item_id = ?
      `, [String(CANONICAL_BIRU_ID), String(LEGACY_BIRU_ID)]);
      db.run("DELETE FROM content_favorites WHERE item_type = 'word' AND item_id = ?", [String(LEGACY_BIRU_ID)]);
    }

    migrateSessionState();
    db.run("DELETE FROM words WHERE id = ?", [LEGACY_BIRU_ID]);
    setState(MIGRATION_STATE_KEY, LEGACY_BIRU_MIGRATION_VERSION);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  persistSoon();
  return { migrated: true, winnerId, canonicalSeenCount, legacySeenCount, movedReviews };
}

/** 启动入口：先保存整库恢复点，成功后才执行迁移。 */
export async function ensureLegacyBiruMigration(): Promise<LegacyBiruMigrationReport | null> {
  if (!legacyBiruMigrationNeeded()) return null;
  const { saveRecoverySnapshot } = await import("./storage");
  const recovery = await saveRecoverySnapshot("before-biru-2480-to-775");
  const report = migrateLegacyBiruDuplicate();
  console.log("[migration] ビル 2480→775 merged", { ...report, recovery });
  return report;
}
