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

export const wordRowExists = (table: string, wordId: number, extraWhere = "", params: Array<string | number> = []): boolean => (
  firstValue<number>(
    `SELECT 1 FROM ${quoteIdentifier(table)} WHERE word_id = ?${extraWhere} LIMIT 1`,
    [wordId, ...params],
    0
  ) === 1
);

/**
 * 把 from 的一行复制到 into，再显式删除 from 那行。
 * 显式 DELETE 很重要：同步触发器会为旧 id 写墓碑，避免另一台设备把旧行复活。
 */
export const replaceSingleRow = (
  db: Database,
  table: string,
  fromId: number,
  intoId: number,
  preferFrom: boolean,
  extraWhere = "",
  params: Array<string | number> = []
): void => {
  if (!tableExists(table) || !wordRowExists(table, fromId, extraWhere, params)) return;
  const canonicalExists = wordRowExists(table, intoId, extraWhere, params);
  if (!canonicalExists || preferFrom) {
    if (canonicalExists) {
      db.run(`DELETE FROM ${quoteIdentifier(table)} WHERE word_id = ?${extraWhere}`, [intoId, ...params]);
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
      [intoId, fromId, ...params]
    );
  }
  db.run(`DELETE FROM ${quoteIdentifier(table)} WHERE word_id = ?${extraWhere}`, [fromId, ...params]);
};

export const migrateDatedRows = (
  db: Database,
  table: string,
  fromId: number,
  intoId: number,
  preferFrom: boolean
): void => {
  if (!tableExists(table)) return;
  const dates = rowsFor(
    `SELECT reviewed_on FROM ${quoteIdentifier(table)} WHERE word_id = ? ORDER BY reviewed_on`,
    [fromId]
  );
  dates.forEach((row) => {
    replaceSingleRow(db, table, fromId, intoId, preferFrom, " AND reviewed_on = ?", [String(row.reviewed_on ?? "")]);
  });
};

type Remap = (wordId: number) => number;

const rewriteQueue = (raw: string, remap: Remap): string => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return raw;
    const byWord = new Map<number, Record<string, unknown>>();
    parsed.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const record = item as Record<string, unknown>;
      const originalId = Number(record.word_id);
      const wordId = remap(originalId);
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

const rewriteWordIdsDeep = (value: unknown, remap: Remap): unknown => {
  if (Array.isArray(value)) return value.map((item) => rewriteWordIdsDeep(item, remap));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    key === "word_id" && Number.isFinite(Number(item))
      ? remap(Number(item))
      : rewriteWordIdsDeep(item, remap)
  ]));
};

const rewriteJsonState = (key: string, remap: Remap): void => {
  const raw = getState(key, "");
  if (!raw) return;
  try {
    setState(key, JSON.stringify(rewriteWordIdsDeep(JSON.parse(raw), remap)));
  } catch {
    // 不是合法 JSON 就保持原样；这些键下一次正常作答会自行覆盖。
  }
};

/**
 * 会话状态里也散着 word_id：当前卡、重刷队列、撤销快照。
 * 合并之后这些键如果还指着被删掉的行，下一次取卡会拿到一个不存在的词。
 */
export const remapSessionStateWordIds = (remap: Remap): void => {
  ["review_queue", "review_queue_reverse", "review_queue_kanji", "review_queue_kanji_reading"].forEach((key) => {
    const raw = getState(key, "");
    if (raw) setState(key, rewriteQueue(raw, remap));
  });
  ["current_card", "last_answered_word", "last_answered_word_reverse", "last_answered_word_kanji", "last_answered_word_kanji_reading"].forEach((key) => {
    const current = Number(getState(key, "0"));
    if (!current) return;
    const next = remap(current);
    if (next !== current) setState(key, String(next));
  });
  ["last_answer", "undo_pinned_card"].forEach((key) => rewriteJsonState(key, remap));
};

/**
 * 把 fromId 这个词的全部用户数据搬到 intoId 上，然后删掉 fromId 的词条行。
 *
 * 三个方向的长期记忆各自按「答过的次数多」的一行取胜；流水、便签、收藏、当天任务
 * 全部搬过去。**不是**简单删行 —— 老库去重当年就是因为「删行会连带删掉学习记录」
 * 才一直没做，这里把记录先搬走再删。
 *
 * 调用方负责事务和恢复点。
 */
export const mergeWordInto = (db: Database, fromId: number, intoId: number): number => {
  if (fromId === intoId) return 0;
  const fromSeen = firstValue<number>("SELECT seen_count FROM progress WHERE word_id = ?", [fromId], 0);
  const intoSeen = firstValue<number>("SELECT seen_count FROM progress WHERE word_id = ?", [intoId], 0);
  const preferFrom = fromSeen > intoSeen;
  const movedReviews = tableExists("reviews")
    ? firstValue<number>("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [fromId], 0)
    : 0;

  replaceSingleRow(db, "progress", fromId, intoId, preferFrom);
  ["reverse_memory", "kanji_memory", "kanji_reading_memory"].forEach((table) => {
    if (!tableExists(table)) return;
    const keepClicks = firstValue<number>(
      `SELECT COALESCE(seen_count, 0) FROM ${quoteIdentifier(table)} WHERE word_id = ?`,
      [intoId],
      0
    );
    const dropClicks = firstValue<number>(
      `SELECT COALESCE(seen_count, 0) FROM ${quoteIdentifier(table)} WHERE word_id = ?`,
      [fromId],
      0
    );
    replaceSingleRow(db, table, fromId, intoId, dropClicks > keepClicks);
  });

  ["stage1_tasks", "stage2_progress", "kanji_progress", "kanji_reading_progress", "critical_reviews"].forEach((table) => {
    migrateDatedRows(db, table, fromId, intoId, preferFrom);
  });
  replaceSingleRow(db, "word_notes", fromId, intoId, preferFrom || !wordRowExists("word_notes", intoId));
  // 用户手改的题面跟着走：合并掉的那行如果改过题面，而存活的那行没改过，
  // 直接删行会把他写的东西一起删掉。
  // 只传 preferFrom：replaceSingleRow 内部已经是 `!canonicalExists || preferFrom`，
  // 外面再写一次 !wordRowExists 是等价的冗余，而且会在老库上抢先查一张不存在的表。
  replaceSingleRow(db, "word_question_meanings", fromId, intoId, preferFrom);
  replaceSingleRow(db, "moji_migrated_reviews", fromId, intoId, preferFrom || !wordRowExists("moji_migrated_reviews", intoId));
  if (tableExists("dictionary_discovered_words")) {
    db.run("INSERT OR IGNORE INTO dictionary_discovered_words (word_id) VALUES (?)", [intoId]);
    db.run("DELETE FROM dictionary_discovered_words WHERE word_id = ?", [fromId]);
  }

  // 流水改挂到存活的那行。reviews 的同步身份是 sync_uid；直接 UPDATE 会让
  // 旧身份在别的设备上留着不动（更新不写墓碑），所以先删后插：
  // 删触发墓碑杀掉旧身份，插进来的是新身份。
  if (tableExists("reviews")) {
    const columns = columnsOf("reviews").filter((column) => (
      column !== "id" && column !== "sync_updated_at" && column !== "sync_origin_device" && column !== "sync_uid"
    ));
    const selectColumns = columns.map((column) => (column === "word_id" ? "?" : quoteIdentifier(column)));
    db.run(
      `INSERT INTO reviews (${columns.map(quoteIdentifier).join(", ")})
       SELECT ${selectColumns.join(", ")} FROM reviews WHERE word_id = ?`,
      [intoId, fromId]
    );
    db.run("DELETE FROM reviews WHERE word_id = ?", [fromId]);
  }

  if (tableExists("content_favorites")) {
    db.run(`
      INSERT OR IGNORE INTO content_favorites (item_type, item_id)
      SELECT item_type, ? FROM content_favorites
      WHERE item_type = 'word' AND item_id = ?
    `, [String(intoId), String(fromId)]);
    db.run("DELETE FROM content_favorites WHERE item_type = 'word' AND item_id = ?", [String(fromId)]);
  }

  db.run("DELETE FROM words WHERE id = ?", [fromId]);
  return movedReviews;
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
    mergeWordInto(db, LEGACY_BIRU_ID, CANONICAL_BIRU_ID);
    remapSessionStateWordIds((wordId) => (wordId === LEGACY_BIRU_ID ? CANONICAL_BIRU_ID : wordId));
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
