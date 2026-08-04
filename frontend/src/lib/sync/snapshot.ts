import type { Database } from "sql.js";
import { createDatabase, getDatabase } from "../database";
import { ensureSyncSchema } from "./schema";
import { DEVICE_LOCAL_STATE_KEYS, SYNCED_TABLES } from "./tables";

export const SYNC_SNAPSHOT_FORMAT = "master-nihongo-user-sqlite-v1";
export type SyncSnapshotCompression = "gzip" | "none";
const MAX_UNCOMPRESSED_SNAPSHOT_BYTES = 20_000_000;

const META_TABLE = "sync_snapshot_meta";
const EXTRA_TABLES = ["sync_tombstones"];
type SnapshotValue = string | number | null | Uint8Array;

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const firstValue = (db: Database, sql: string, params: SnapshotValue[] = []): unknown => (
  db.exec(sql, params)[0]?.values[0]?.[0]
);

const tableExists = (db: Database, table: string): boolean => Boolean(
  firstValue(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", [table])
);

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
  const result = source.exec(
    `SELECT * FROM ${quoteIdentifier(table)}${
      excludeDeviceLocalState ? ` WHERE key NOT IN (${localStateKeys.map(() => "?").join(", ")})` : ""
    }`,
    excludeDeviceLocalState ? localStateKeys : []
  )[0];
  if (!result?.values.length) return;
  const columns = result.columns.map(quoteIdentifier).join(", ");
  const placeholders = result.columns.map(() => "?").join(", ");
  const insert = `INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES (${placeholders})`;
  target.run("BEGIN");
  try {
    for (const row of result.values) target.run(insert, row);
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
        format TEXT PRIMARY KEY
      )
    `);
    // 元数据不能放“导出时间”：否则学习数据完全没变时，快照哈希仍然变化，
    // 会破坏服务端对超时重试的内容幂等判断。
    snapshot.run(`INSERT INTO ${META_TABLE} (format) VALUES (?)`, [SYNC_SNAPSHOT_FORMAT]);
    const tables = new Set([...SYNCED_TABLES.map((entry) => entry.table), ...EXTRA_TABLES]);
    for (const table of tables) copyTable(source, snapshot, table);
    return new Uint8Array(snapshot.export());
  } finally {
    snapshot.close();
  }
}

export const isUserSyncSnapshot = (db: Database): boolean => {
  if (!tableExists(db, META_TABLE)) return false;
  return firstValue(db, `SELECT format FROM ${META_TABLE} LIMIT 1`) === SYNC_SNAPSHOT_FORMAT;
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
