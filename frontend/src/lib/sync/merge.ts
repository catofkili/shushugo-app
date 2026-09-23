import type { Database } from "sql.js";
import { exportDatabase, getDatabase, openDatabase } from "../database";
import {
  beginSyncApply,
  endSyncApply,
  ensureLegacyMemoryColumns,
  ensureSyncSchema,
  SYNC_ORIGIN_COL,
  SYNC_UPDATED_COL
} from "./schema";
import { isDeviceLocalStateKey, SYNCED_TABLES, syncedTablesForCloud, type SyncedTable } from "./tables";
import { isUserSyncSnapshot } from "./snapshot";
import { canUseFeature, getEntitlements } from "../entitlements";
import { rebuildStudyTimeAggregate } from "./study-time";
import { GRAMMAR_HIGHLIGHTS_UPDATED_EVENT, GRAMMAR_POSITIONS_UPDATED_EVENT } from "../grammar-events";
import { resetFamiliarityCache } from "../models/familiarity";
import { resetQuestionMeaningIndex } from "../models/question-meaning-index";
import { resetUserQuestionMeanings } from "../models/user-question-meanings";
import { ensureFsrsColumns } from "../fsrs-store";

const ROW_SEPARATOR = "\u001f";
const DEFAULT_ORIGIN = "legacy";

type Cell = string | number | null | Uint8Array;
type Row = Record<string, Cell>;

interface VersionedItem {
  key: string;
  row?: Row;
  deleted: boolean;
  changedAt: string;
  originDevice: string;
}

interface DatabaseState {
  rows: Map<string, Map<string, VersionedItem>>;
}

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const tableExists = (db: Database, table: string): boolean => {
  const statement = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1");
  try {
    statement.bind([table]);
    return statement.step();
  } finally {
    statement.free();
  }
};

const columnsOf = (db: Database, table: string): Set<string> => {
  if (!tableExists(db, table)) return new Set();
  const statement = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`);
  try {
    const result = new Set<string>();
    while (statement.step()) result.add(String(statement.get()[1]));
    return result;
  } finally {
    statement.free();
  }
};

/**
 * 新快照不能被「认识一半」的客户端重新上传。
 *
 * Worker 保存的是每次上传的完整用户快照；如果这里静默忽略一张新表或一列，
 * 下一次上传就会把它从云端当前版本削掉。旧整库快照保持原有兼容路径，只有
 * 带同步元数据的新格式需要在写入前确认本机可以无损往返。
 */
const assertSnapshotWritable = (
  remote: Database,
  local: Database,
  entries: SyncedTable[]
): void => {
  const runtimeAddedColumns = new Set([
    "sync_updated_at",
    "sync_origin_device",
    "sync_uid"
  ]);
  const allowed = new Set([
    "sync_snapshot_meta",
    "sync_tombstones",
    // 小程序 0.1.x 自创的表，推上云的快照里会有。9-22 起小程序也用网页这套表，
    // legacy-migrations 会把它们折进 achievements / 直接删掉 —— 丢弃正是想要的结果，
    // 不能因为它们整次拒绝同步。
    "direction_tasks",
    "mode_tasks",
    "achievement_unlocked",
    ...entries.map((entry) => entry.table)
  ]);
  const statement = remote.prepare("SELECT name FROM sqlite_master WHERE type = 'table'");
  const tables: string[] = [];
  try {
    while (statement.step()) tables.push(String(statement.get()[0] ?? ""));
  } finally {
    statement.free();
  }
  const unknown = tables
    .filter((table) => table && table !== "sqlite_sequence" && !allowed.has(table));
  if (unknown.length) {
    throw new Error(`云端学习数据包含当前版本无法保留的表：${unknown.join(", ")}，请先更新应用。`);
  }
  for (const entry of entries) {
    if (!tableExists(remote, entry.table)) continue;
    if (!tableExists(local, entry.table)) {
      throw new Error(`云端学习数据需要表 ${entry.table}，当前版本无法无损保存，请先更新应用。`);
    }
    const localColumns = columnsOf(local, entry.table);
    const missing = [...columnsOf(remote, entry.table)]
      .filter((column) => !localColumns.has(column) && !runtimeAddedColumns.has(column));
    if (missing.length) {
      throw new Error(
        `云端学习数据的 ${entry.table} 包含当前版本无法保留的列：${missing.join(", ")}，请先更新应用。`
      );
    }
  }
};

const rowsOf = (db: Database, table: string): Row[] => {
  if (!tableExists(db, table)) return [];
  const statement = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`);
  try {
    const result: Row[] = [];
    while (statement.step()) result.push(statement.getAsObject() as Row);
    return result;
  } finally {
    statement.free();
  }
};

const rowKey = (entry: SyncedTable, row: Row): string =>
  entry.keys.map((key) => String(row[key] ?? "")).join(ROW_SEPARATOR);

const changedAtOf = (row: Row | undefined): string =>
  String(row?.[SYNC_UPDATED_COL] ?? "1970-01-01T00:00:00.000Z");

const originOf = (row: Row | undefined): string =>
  String(row?.[SYNC_ORIGIN_COL] ?? DEFAULT_ORIGIN);

const compareVersion = (left: VersionedItem, right: VersionedItem): number => {
  if (left.changedAt !== right.changedAt) return left.changedAt > right.changedAt ? 1 : -1;
  if (left.originDevice === right.originDevice) return 0;
  return left.originDevice > right.originDevice ? 1 : -1;
};

const stateOf = (db: Database, sourceOrigin: string, entries: SyncedTable[]): DatabaseState => {
  const rows = new Map<string, Map<string, VersionedItem>>();

  for (const entry of entries) {
    if (!tableExists(db, entry.table)) continue;
    const items = new Map<string, VersionedItem>();
    for (const row of rowsOf(db, entry.table)) {
      // v1 snapshots may predate sync_uid. Keep each legacy event distinct
      // instead of collapsing every row onto the empty natural key; current
      // snapshots still use the trigger-assigned sync_uid path.
      const key = entry.strategy === "append" && !String(row.sync_uid ?? "")
        ? `${String(row.sync_origin_device ?? sourceOrigin)}:${String(
          row.id ?? `${row.word_id ?? row.grammar_id ?? row.unit_key ?? ""}|${row.answer ?? ""}|${row.reviewed_on ?? ""}|${row.created_at ?? ""}`
        )}`
        : rowKey(entry, row);
      if (isDeviceLocalStateKey(entry.table, String(row.key ?? ""))) continue;
      items.set(key, {
        key,
        row,
        deleted: false,
        changedAt: changedAtOf(row),
        originDevice: originOf(row) || sourceOrigin
      });
    }
    rows.set(entry.table, items);
  }

  if (tableExists(db, "sync_tombstones")) {
    for (const tombstone of rowsOf(db, "sync_tombstones")) {
      const table = String(tombstone.table_name ?? "");
      const key = String(tombstone.row_key ?? "");
      const entry = entries.find((candidate) => candidate.table === table);
      if (!entry || !rows.has(table)) continue;
      if (isDeviceLocalStateKey(table, key)) continue;
      const item: VersionedItem = {
        key,
        deleted: true,
        changedAt: String(tombstone.deleted_at ?? "1970-01-01T00:00:00.000Z"),
        originDevice: String(tombstone.origin_device ?? sourceOrigin) || sourceOrigin
      };
      const current = rows.get(table)?.get(key);
      if (!current || compareVersion(item, current) > 0) rows.get(table)?.set(key, item);
    }
  }

  return { rows };
};

const mergeItems = (
  entry: SyncedTable,
  local: DatabaseState,
  remote: DatabaseState
): Map<string, VersionedItem> => {
  const merged = new Map<string, VersionedItem>();
  const localItems = local.rows.get(entry.table) ?? new Map();
  const remoteItems = remote.rows.get(entry.table) ?? new Map();
  const keys = new Set([...localItems.keys(), ...remoteItems.keys()]);

  for (const key of keys) {
    const localItem = localItems.get(key);
    const remoteItem = remoteItems.get(key);
    if (!localItem) {
      if (remoteItem) merged.set(key, remoteItem);
      continue;
    }
    if (!remoteItem) {
      merged.set(key, localItem);
      continue;
    }

    // append / union 仍然用版本解决同一自然键的删除和重复写入；reviews
    // 用 sync_uid 做事件身份，不再把秒级 created_at 当成去重键。
    if (entry.strategy === "append" || entry.strategy === "union" || entry.strategy === "lww") {
      merged.set(key, compareVersion(localItem, remoteItem) >= 0 ? localItem : remoteItem);
    }
  }
  return merged;
};

const mergedRow = (selected: VersionedItem, localRow: Row | undefined): Row | undefined => {
  if (selected.deleted) return undefined;
  // 新版本可能新增了 NOT NULL 列。对于同一行优先保留本机已有列,
  // 再覆盖云端值,这样旧客户端的备份不会因为缺列而无法恢复。
  return { ...(localRow ?? {}), ...(selected.row ?? {}) };
};

const cellsEqual = (left: Cell | undefined, right: Cell | undefined): boolean => {
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }
  return left === right;
};

const rowsEqual = (left: Row | undefined, right: Row | undefined, columns: Set<string>): boolean => {
  if (!left || !right) return false;
  for (const column of columns) {
    if (!cellsEqual(left[column], right[column])) return false;
  }
  return true;
};

const deleteRowByKey = (db: Database, entry: SyncedTable, key: string): void => {
  const values = key.split(ROW_SEPARATOR);
  const where = entry.keys.map((column) => `${quoteIdentifier(column)} = ?`).join(" AND ");
  db.run(`DELETE FROM ${quoteIdentifier(entry.table)} WHERE ${where}`, values as never);
};

/**
 * 表自身的主键列里,不参与同步身份判定的那些(典型:reviews.id 这种自增 id)。
 *
 * 事件日志两端各自自增,一定会撞车:两台设备都会产生 id=5001。如果照抄云端的
 * id 写下去,INSERT OR REPLACE 会因为主键冲突把本机那条同 id 的复习记录**删掉**,
 * 而 REPLACE 在 recursive_triggers 关闭时不触发 DELETE 触发器 —— 不写墓碑、
 * 不报错、下次同步也不会恢复,等于静默永久丢一条复习流水。
 */
const foreignKeyedPrimaryColumns = (db: Database, entry: SyncedTable): string[] => {
  if (!tableExists(db, entry.table)) return [];
  const syncKeys = new Set(entry.keys);
  const statement = db.prepare(`PRAGMA table_info(${quoteIdentifier(entry.table)})`);
  try {
    const result: string[] = [];
    while (statement.step()) {
      const row = statement.get();
      if (Number(row[5] ?? 0) > 0 && !syncKeys.has(String(row[1]))) result.push(String(row[1]));
    }
    return result;
  } finally {
    statement.free();
  }
};

const applyTable = (
  db: Database,
  entry: SyncedTable,
  selected: Map<string, VersionedItem>
): void => {
  if (!tableExists(db, entry.table)) return;
  const columns = columnsOf(db, entry.table);
  const localRows = rowsOf(db, entry.table);
  const localByKey = new Map(localRows.map((row) => [rowKey(entry, row), row]));
  const writableColumns = new Set(columns);
  const borrowedPrimaryColumns = foreignKeyedPrimaryColumns(db, entry);
  const changes: Array<() => void> = [];

  for (const [key, item] of selected) {
    if (isDeviceLocalStateKey(entry.table, key)) continue;
    const current = localByKey.get(key);
    const row = mergedRow(item, current);
    if (!row) {
      if (current) changes.push(() => deleteRowByKey(db, entry, key));
      continue;
    }
    // v1 快照可能没有 sync_uid。stateOf 已用「来源 + 原表 id」给它造了
    // 稳定身份；写回时也要把这身份落进本机，避免远端合并后留下 NULL 事件，
    // 下一次删除又无法写墓碑。
    if (entry.strategy === "append" && !String(row.sync_uid ?? "")) row.sync_uid = key;
    // 云端的自增主键在本机没有意义:本机已有这行就沿用本机 id,
    // 是新行就把 id 拿掉,让 SQLite 重新分配一个不冲突的。
    for (const column of borrowedPrimaryColumns) {
      if (current && current[column] != null) row[column] = current[column];
      else delete row[column];
    }
    if (rowsEqual(current, row, writableColumns)) continue;
    const rowColumns = Object.keys(row).filter((column) => writableColumns.has(column));
    if (!rowColumns.length) continue;
    const names = rowColumns.map(quoteIdentifier).join(", ");
    const placeholders = rowColumns.map(() => "?").join(", ");
    changes.push(() => db.run(
      `INSERT OR REPLACE INTO ${quoteIdentifier(entry.table)} (${names}) VALUES (${placeholders})`,
      rowColumns.map((column) => row[column]) as never
    ));
  }

  changes.forEach((change) => change());
};

const applyTombstones = (
  db: Database,
  merged: Map<string, Map<string, VersionedItem>>
): void => {
  if (!tableExists(db, "sync_tombstones")) return;
  // 只重建本次参与合并的表。权益限制可能让 weekly_reports 不参与本次合并；
  // 清空整张墓碑表会让它以后恢复权益时重新复活。
  for (const table of merged.keys()) db.run("DELETE FROM sync_tombstones WHERE table_name = ?", [table]);
  const columns = columnsOf(db, "sync_tombstones");
  for (const [table, items] of merged) {
    for (const item of items.values()) {
      if (!item.deleted) continue;
      const values: Row = {
        table_name: table,
        row_key: item.key,
        deleted_at: item.changedAt,
        origin_device: item.originDevice
      };
      const writableColumns = Object.keys(values).filter((column) => columns.has(column));
      db.run(
        `INSERT OR REPLACE INTO sync_tombstones (${writableColumns.map(quoteIdentifier).join(", ")})
         VALUES (${writableColumns.map(() => "?").join(", ")})`,
        writableColumns.map((column) => values[column]) as never
      );
    }
  }
};

/**
 * 按行合并本机与云端快照。它保留不同单词的并行学习,复习流水取并集,
 * 同一行冲突才按「更新时间 + 设备号」做确定性的 LWW,并把删除作为墓碑保留。
 */
export async function mergeDatabaseBytes(remoteBytes: Uint8Array): Promise<Uint8Array> {
  ensureSyncSchema();
  const localDb = getDatabase();
  const remoteDb = await openDatabase(remoteBytes);
  try {
    const legacyFullSnapshot = tableExists(remoteDb, "words")
      && tableExists(remoteDb, "progress")
      && tableExists(remoteDb, "app_state");
    const isNewSnapshot = isUserSyncSnapshot(remoteDb);
    if (!legacyFullSnapshot && !isNewSnapshot) {
      throw new Error("云端学习数据格式无效，已保留本机数据。");
    }
    const syncedTables = syncedTablesForCloud(canUseFeature("weeklyReportCloudHistory", getEntitlements()));
    // fsrs_* 列由运行时迁移按需补在各表上（单词、语法，以及混合学习的汉字卡 /
    // 辨析卡 / 假名卡），本机可能还没碰过那张表。先按对端有什么就补什么，
    // 再做能力检查，否则一个本可无损兼容的库会被误判成「新列无法保存」而整次同步被拒。
    // 不手列实体：9-17 那版只列了四张表，9-20 加的混合学习表就被误拒过。
    for (const entry of syncedTables) {
      if (!tableExists(localDb, entry.table) || !tableExists(remoteDb, entry.table)) continue;
      ensureLegacyMemoryColumns(entry.table);
      const local = columnsOf(localDb, entry.table);
      if ([...columnsOf(remoteDb, entry.table)].some((column) => column.startsWith("fsrs_") && !local.has(column))) {
        ensureFsrsColumns({ table: entry.table, idColumn: "", eligible: "" });
      }
    }
    // 能力检查依据版本支持的完整表结构；权益变化后遇到旧周报不应阻断普通进度。
    // 实际合并范围仍由 syncedTables 控制，未参与的周报和墓碑保持本机原样。
    if (isNewSnapshot) assertSnapshotWritable(remoteDb, localDb, SYNCED_TABLES);
    // 动态模块先加载完，再停同步触发器并进入事务；事务中不 await，用户作答不会
    // 插进“触发器关闭”的窗口，也不会出现前几张表成功、后面失败的半份合并。
    const replayKanjiUnitReviews = tableExists(localDb, "kanji_unit_reviews")
      ? (await import("../kanji-unit-scheduler")).replayKanjiUnitReviews : undefined;
    const replayKanjiCharReviews = tableExists(localDb, "kanji_char_reviews")
      ? (await import("../kanji-char-cards")).replayKanjiCharReviews : undefined;
    const replayConfusionReviews = tableExists(localDb, "confusion_reviews")
      ? (await import("../confusion-cards")).replayConfusionReviews : undefined;
    const replayKanaReviews = tableExists(localDb, "kana_reviews")
      ? (await import("../kana-progress")).replayKanaReviews : undefined;
    const materializeCustomWords = tableExists(localDb, "custom_words")
      ? (await import("../word-list-import")).materializeCustomWords : undefined;
    const localState = stateOf(localDb, "local", syncedTables);
    const remoteState = stateOf(remoteDb, "remote", syncedTables);
    const merged = new Map<string, Map<string, VersionedItem>>();

    beginSyncApply();
    localDb.run("BEGIN TRANSACTION");
    try {
      for (const entry of syncedTables) {
        const items = mergeItems(entry, localState, remoteState);
        merged.set(entry.table, items);
        applyTable(localDb, entry, items);
      }
      applyTombstones(localDb, merged);
      replayKanjiUnitReviews?.();
      replayKanjiCharReviews?.();
      replayConfusionReviews?.();
      replayKanaReviews?.();
      rebuildStudyTimeAggregate();
      materializeCustomWords?.();
      localDb.run("COMMIT");
    } catch (error) {
      localDb.run("ROLLBACK");
      throw error;
    } finally {
      endSyncApply();
    }
    // 对端同步下来一批新学的词,「学过没」的名单跟着变 —— 易混词按它筛候选。
    resetFamiliarityCache();
    // 对端改过的题面也一起下来了。这两份是内存缓存,不清的话学习页会一直显示
    // 旧题面、撞车分组也停在合并前的样子,直到用户刷新页面才对上。
    resetUserQuestionMeanings();
    resetQuestionMeaningIndex();
    // 语法页使用 SQLite 中的缓存；合并完成后通知已挂载的页面重新读一次，
    // 不要求用户刷新正在学习的页面。
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(GRAMMAR_HIGHLIGHTS_UPDATED_EVENT));
      window.dispatchEvent(new Event(GRAMMAR_POSITIONS_UPDATED_EVENT));
    }
    const result = exportDatabase();
    if (!result) throw new Error("当前没有可合并的本地数据库。");
    return result;
  } finally {
    remoteDb.close();
  }
}
