import type { Database } from "sql.js";
import { exportDatabase, getDatabase, openDatabase } from "../database";
import {
  beginSyncApply,
  endSyncApply,
  ensureSyncSchema,
  SYNC_ORIGIN_COL,
  SYNC_UPDATED_COL
} from "./schema";
import { DEVICE_LOCAL_STATE_KEYS, SYNCED_TABLES, type SyncedTable } from "./tables";
import { isUserSyncSnapshot } from "./snapshot";
import { rebuildStudyTimeAggregate } from "./study-time";

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
  const result = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", [table]);
  return result.length > 0 && result[0].values.length > 0;
};

const columnsOf = (db: Database, table: string): Set<string> => {
  if (!tableExists(db, table)) return new Set();
  const result = db.exec(`PRAGMA table_info(${quoteIdentifier(table)})`);
  return new Set(result[0]?.values.map((row) => String(row[1])) ?? []);
};

const rowsOf = (db: Database, table: string): Row[] => {
  if (!tableExists(db, table)) return [];
  const result = db.exec(`SELECT * FROM ${quoteIdentifier(table)}`)[0];
  if (!result) return [];
  return result.values.map((values) => Object.fromEntries(
    result.columns.map((column, index) => [column, values[index] as Cell])
  ));
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

const stateOf = (db: Database, sourceOrigin: string): DatabaseState => {
  const rows = new Map<string, Map<string, VersionedItem>>();

  for (const entry of SYNCED_TABLES) {
    if (!tableExists(db, entry.table)) continue;
    const items = new Map<string, VersionedItem>();
    for (const row of rowsOf(db, entry.table)) {
      const key = rowKey(entry, row);
      if (entry.table === "app_state" && DEVICE_LOCAL_STATE_KEYS.has(String(row.key ?? ""))) continue;
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
      const entry = SYNCED_TABLES.find((candidate) => candidate.table === table);
      if (!entry || !rows.has(table)) continue;
      if (table === "app_state" && DEVICE_LOCAL_STATE_KEYS.has(key)) continue;
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

    // append / union 仍然用版本解决同一键的删除和重复写入;
    // 不同 review 的 sync_uid 不同,因此会自然保留两端记录。
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
  const info = db.exec(`PRAGMA table_info(${quoteIdentifier(entry.table)})`)[0];
  const syncKeys = new Set(entry.keys);
  return (info?.values ?? [])
    .filter((row) => Number(row[5] ?? 0) > 0 && !syncKeys.has(String(row[1])))
    .map((row) => String(row[1]));
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
    if (entry.table === "app_state" && DEVICE_LOCAL_STATE_KEYS.has(key)) continue;
    const current = localByKey.get(key);
    const row = mergedRow(item, current);
    if (!row) {
      if (current) changes.push(() => deleteRowByKey(db, entry, key));
      continue;
    }
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

  if (!changes.length) return;
  db.run("BEGIN");
  try {
    changes.forEach((change) => change());
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
};

const applyTombstones = (
  db: Database,
  merged: Map<string, Map<string, VersionedItem>>
): void => {
  if (!tableExists(db, "sync_tombstones")) return;
  db.run("DELETE FROM sync_tombstones");
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
  const legacyFullSnapshot = tableExists(remoteDb, "words")
    && tableExists(remoteDb, "progress")
    && tableExists(remoteDb, "app_state");
  if (!legacyFullSnapshot && !isUserSyncSnapshot(remoteDb)) {
    remoteDb.close();
    throw new Error("云端学习数据格式无效，已保留本机数据。");
  }
  const localState = stateOf(localDb, "local");
  const remoteState = stateOf(remoteDb, "remote");
  const merged = new Map<string, Map<string, VersionedItem>>();

  beginSyncApply();
  try {
    for (const entry of SYNCED_TABLES) {
      const items = mergeItems(entry, localState, remoteState);
      merged.set(entry.table, items);
      applyTable(localDb, entry, items);
    }
    applyTombstones(localDb, merged);
    // 对端的学习时长同步下来了,但读取方看的是 word_study_time 的每日合计,
    // 不重算一次统计页就只显示本机那份。
    rebuildStudyTimeAggregate();
  } finally {
    endSyncApply();
    remoteDb.close();
  }

  const result = exportDatabase();
  if (!result) throw new Error("当前没有可合并的本地数据库。");
  return result;
}
