import type { Database } from "sql.js";
import { createDatabase, getDatabase } from "../database";
import { ensureSyncSchema } from "./schema";
import { DEVICE_LOCAL_STATE_KEYS, SYNCED_TABLES } from "./tables";

export const SYNC_SNAPSHOT_FORMAT = "master-nihongo-user-sqlite-v1";
/** 同步协议版本独立于 SQLite schema，便于将来切换增量协议而不误读旧快照。 */
export const SYNC_PROTOCOL_VERSION = 2;
/** v1 snapshots remain readable; new exports are always v2. */
export const SUPPORTED_SYNC_PROTOCOL_VERSIONS = new Set([1, SYNC_PROTOCOL_VERSION]);
export type SyncSnapshotCompression = "gzip" | "none";
const MAX_UNCOMPRESSED_SNAPSHOT_BYTES = 20_000_000;

const META_TABLE = "sync_snapshot_meta";
const EXTRA_TABLES = ["sync_tombstones"];
type SnapshotValue = string | number | null | Uint8Array;

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const firstValue = (db: Database, sql: string, params: SnapshotValue[] = []): unknown => (
  (() => {
    const statement = db.prepare(sql);
    try {
      if (params.length) statement.bind(params);
      return statement.step() ? statement.get()[0] : undefined;
    } finally {
      statement.free();
    }
  })()
);

const tableExists = (db: Database, table: string): boolean => Boolean(
  firstValue(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", [table])
);

/**
 * 当日任务表只往快照里放最近这些天的行。
 *
 * stage1_tasks 是「今日计划」的物化，不是源数据 —— 队列的唯一真相是 progress
 * 里的 FSRS 状态（见 CLAUDE.md）。而它涨得最快：实测用户库 33 天就攒了 25,463 行，
 * 占整份快照 86,361 行的三成，gzip 后每次上传都要为它多传 0.42 MB（1.59 → 1.17 MB，
 * 省 26.7%），还要乘以云端保留的 3 代。
 *
 * 读它的地方最远只看到昨天（plan-trend 拿昨天的复习数当账，其余全是 reviewed_on = 今天），
 * 统计和成就一律从 reviews/progress 现算。留 14 天是给「跨时区 + 隔几天才开一次
 * App」留的余量，不是因为有人需要第 14 天那一行。
 *
 * **这样裁是安全的，因为合并是按键取并集**：另一台设备本地已有的历史行不会因为
 * 这份快照里没有就消失（删除只走 sync_tombstones，见 merge.ts 的 mergeItems）。
 * 唯一的影响是全新设备恢复备份时只拿到最近 14 天的任务表 —— 而那正是没人会读的部分。
 */
const DATED_TABLE_RETENTION_DAYS: Record<string, number> = {
  stage1_tasks: 14
};

const retentionCutoff = (days: number): string => {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
};

const copyTable = (source: Database, target: Database, table: string): void => {
  if (!tableExists(source, table)) return;
  const createSql = String(firstValue(
    source,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table]
  ) ?? "");
  if (!createSql) throw new Error(`无法导出同步表结构：${table}`);
  target.run(createSql);

  const localStateKeys = [...DEVICE_LOCAL_STATE_KEYS];
  const excludeDeviceLocalState = table === "app_state" && localStateKeys.length > 0;
  const retentionDays = DATED_TABLE_RETENTION_DAYS[table];
  const bindings: SnapshotValue[] = excludeDeviceLocalState ? [...localStateKeys] : [];
  let where = "";
  if (excludeDeviceLocalState) {
    where = ` WHERE key NOT IN (${localStateKeys.map(() => "?").join(", ")})`;
  } else if (retentionDays) {
    where = " WHERE reviewed_on >= ?";
    bindings.push(retentionCutoff(retentionDays));
  }
  const statement = source.prepare(`SELECT * FROM ${quoteIdentifier(table)}${where}`);
  let columns: string[] = [];
  const values: SnapshotValue[][] = [];
  try {
    if (bindings.length) statement.bind(bindings);
    while (statement.step()) {
      const row = statement.get();
      values.push(row as SnapshotValue[]);
      if (!columns.length) columns = Object.keys(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  if (!values.length) return;
  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const insert = `INSERT INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES (${placeholders})`;
  target.run("BEGIN");
  try {
    for (const row of values) target.run(insert, row);
    target.run("COMMIT");
  } catch (error) {
    target.run("ROLLBACK");
    throw error;
  }
};

/**
 * 只导出用户学习数据。words / grammar_points 等出厂内容由 App 版本统一提供，
 * 不能再为每个账号、每次答题重复上传和保存。
 */
export async function exportSyncSnapshot(): Promise<Uint8Array> {
  ensureSyncSchema();
  const source = getDatabase();
  const snapshot = await createDatabase();
  try {
    snapshot.run(`
      CREATE TABLE ${META_TABLE} (
        format TEXT PRIMARY KEY,
        protocol_version INTEGER NOT NULL
      )
    `);
    // 元数据不能放“导出时间”：否则学习数据完全没变时，快照哈希仍然变化，
    // 会破坏服务端对超时重试的内容幂等判断。
    snapshot.run(`INSERT INTO ${META_TABLE} (format, protocol_version) VALUES (?, ?)`, [SYNC_SNAPSHOT_FORMAT, SYNC_PROTOCOL_VERSION]);
    const tables = new Set([...SYNCED_TABLES.map((entry) => entry.table), ...EXTRA_TABLES]);
    for (const table of tables) copyTable(source, snapshot, table);
    return new Uint8Array(snapshot.export());
  } finally {
    snapshot.close();
  }
}

export const isUserSyncSnapshot = (db: Database): boolean => {
  if (!tableExists(db, META_TABLE)) return false;
  if (firstValue(db, `SELECT format FROM ${META_TABLE} LIMIT 1`) !== SYNC_SNAPSHOT_FORMAT) return false;
  // v1 快照早期只有 format 列；同一 format 的旧快照仍然按 v1 兼容读取。
  const columns = firstValue(db, `SELECT COUNT(*) FROM pragma_table_info('${META_TABLE}') WHERE name = 'protocol_version'`);
  if (!Number(columns)) return true;
  return SUPPORTED_SYNC_PROTOCOL_VERSIONS.has(Number(firstValue(db, `SELECT protocol_version FROM ${META_TABLE} LIMIT 1`)));
};

const bytesBuffer = (data: Uint8Array): ArrayBuffer => (
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
);

export async function compressSyncSnapshot(data: Uint8Array): Promise<{
  bytes: Uint8Array;
  compression: SyncSnapshotCompression;
}> {
  if (data.byteLength > MAX_UNCOMPRESSED_SNAPSHOT_BYTES) {
    throw new Error("学习数据快照超过 20 MB，请联系支持处理历史记录。");
  }
  if (typeof CompressionStream === "undefined") return { bytes: data, compression: "none" };
  const stream = new Blob([bytesBuffer(data)]).stream().pipeThrough(new CompressionStream("gzip"));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), compression: "gzip" };
}

export async function decompressSyncSnapshot(
  data: Uint8Array,
  compression: SyncSnapshotCompression
): Promise<Uint8Array> {
  if (compression === "none") {
    if (data.byteLength > MAX_UNCOMPRESSED_SNAPSHOT_BYTES) throw new Error("云端学习数据超过安全大小限制。");
    return data;
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前系统版本无法解压云端学习数据，请升级系统后重试。");
  }
  const stream = new Blob([bytesBuffer(data)]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UNCOMPRESSED_SNAPSHOT_BYTES) {
        await reader.cancel();
        throw new Error("云端学习数据解压后超过 20 MB，已停止处理。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
