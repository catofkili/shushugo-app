import type { Database } from "sql.js";
import { createDatabase, getDatabase } from "../database";
import { ensureSyncSchema } from "./schema";
import { DEVICE_LOCAL_GRAMMAR_STATE_KEYS, DEVICE_LOCAL_STATE_KEYS, SYNCED_TABLES } from "./tables";

export const SYNC_SNAPSHOT_FORMAT = "master-nihongo-user-sqlite-v1";
/** 同步协议版本独立于 SQLite schema，便于将来切换增量协议而不误读旧快照。 */
export const SYNC_PROTOCOL_VERSION = 2;
/** v1 snapshots remain readable; new exports are always v2. */
export const SUPPORTED_SYNC_PROTOCOL_VERSIONS = new Set([1, SYNC_PROTOCOL_VERSION]);
export type SyncSnapshotCompression = "gzip" | "none";
/**
 * 快照压缩**前**的上限。
 *
 * ⚠️ 20 MB 这个数是拍的，而且比 App 自己的内存基线还紧 —— 实测本机整库
 * 39.28 MB，一直常驻在 sql.js 的 WASM 堆里。也就是说「解压出 20 MB 会撑爆内存」
 * 这个担心，在一个已经常驻 39 MB 的进程里不成立。
 *
 * 2026-09-09 实测（真实库 49,696 条 reviews）：快照 13.48 MB 未压缩 / 1.64 MB gzip，
 * **已经用掉 20 MB 的 67.4%**。每条作答占 186 B，用户每天 636 条 = 每天涨 118 KB，
 * 也就是 **2026-11-03 前后撞上 20 MB，同步直接停**。这不是"长期"问题。
 *
 * 抬到 48 MB 买到约 292 天（2027-06 前后），期间设置页会在 85%（40.8 MB）转橙告警。
 * ⚠️ **这是买时间，不是修好了。** 真正的问题是每次小改动仍然上传全部历史，
 * 而 9.24 MB / 13.48 MB 是 reviews，其中约 3.6 MB 是同一个 36 字节设备 UUID
 * 在 `sync_origin_device` 和 `sync_uid` 里重复了五万遍。要根治得上云端增量协议
 * （远端游标、删除、断线重试、离线设备重返、兼容窗口一起设计），
 * 本地的 `local-delta.ts` **不是**那个东西。这件事必须在 48 MB 撞上之前做完。
 *
 * Worker 侧不受影响：它只把 gzip 后的 blob 原样存进 R2，从不解压。
 */
export const MAX_UNCOMPRESSED_SNAPSHOT_BYTES = 48_000_000;

/**
 * 上一次导出的快照有多大。
 *
 * ⚠️ **压缩后再小也不算数**:上限卡在压缩**前**的字节数(见
 * MAX_UNCOMPRESSED_SNAPSHOT_BYTES 的注释)。gzip 后 1.64 MB 会让人以为还早得很,
 * 实际是未压缩的 13.48 MB 在逼近上限。reviews 只增不减,这个数只会往上走;
 * 撞上限之后同步会直接停,用户必须能在停之前看见,而不是以为一直在备份。
 */
let lastSnapshotBytes = 0;

export const getSnapshotCapacity = (): { bytes: number; limit: number; ratio: number } => ({
  bytes: lastSnapshotBytes,
  limit: MAX_UNCOMPRESSED_SNAPSHOT_BYTES,
  ratio: lastSnapshotBytes / MAX_UNCOMPRESSED_SNAPSHOT_BYTES
});

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
  stage1_tasks: 14,
  // 另外四张按日的会话表同理：读它们的地方全部是 `reviewed_on = 今天`
  // （direction-plan 的每一条查询、kanji-unit-scheduler 的每一条查询），
  // critical_reviews 在运行时干脆没有任何读取方，只剩合并迁移会碰它。
  // ⚠️ 「stage1 裁了」不等于这几张自动享受同一条策略 —— 上面这句是逐个查过消费者的结论，
  // 以后有人开始读第 15 天的行，得先改这里。
  stage2_progress: 14,
  kanji_progress: 14,
  kanji_reading_progress: 14,
  kanji_unit_tasks: 14
};

const retentionCutoff = (days: number): string => {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
};

const columnsOf = (db: Database, table: string): string[] => {
  const statement = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`);
  const names: string[] = [];
  try {
    while (statement.step()) names.push(String(statement.getAsObject().name));
  } finally {
    statement.free();
  }
  return names;
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

  // 键值表里的设备本地键在导出这一侧就不放进去。grammar_state 的 dataset_version
  // 也在此列 —— 它说的是「本机这份语法内容迁到哪一版」,不是账号状态。
  const localStateKeys = table === "app_state" ? [...DEVICE_LOCAL_STATE_KEYS]
    : table === "grammar_state" ? [...DEVICE_LOCAL_GRAMMAR_STATE_KEYS]
      : [];
  const retentionDays = DATED_TABLE_RETENTION_DAYS[table];
  const bindings: SnapshotValue[] = [];
  let where = "";
  if (localStateKeys.length) {
    where = ` WHERE key NOT IN (${localStateKeys.map(() => "?").join(", ")})`;
    bindings.push(...localStateKeys);
  } else if (retentionDays) {
    where = " WHERE reviewed_on >= ?";
    bindings.push(retentionCutoff(retentionDays));
  }

  // ⚠️ 边读边写,不要先把整张表装进 values[] 再逐行 run()。
  // reviews 一张表就有四万多行,先攒后写等于在导出的那一刻把整份用户数据
  // 在 JS 堆上再复制一份;而 target.run(sql, row) 每次都会重新 prepare 一遍 SQL。
  const columns = columnsOf(source, table);
  if (!columns.length) return;
  const insert = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) `
    + `VALUES (${columns.map(() => "?").join(", ")})`;
  const read = source.prepare(`SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)}${where}`);
  const write = target.prepare(insert);
  target.run("BEGIN");
  try {
    if (bindings.length) read.bind(bindings);
    while (read.step()) write.run(read.get() as SnapshotValue[]);
    target.run("COMMIT");
  } catch (error) {
    target.run("ROLLBACK");
    throw error;
  } finally {
    read.free();
    write.free();
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
    const bytes = new Uint8Array(snapshot.export());
    lastSnapshotBytes = bytes.byteLength;
    return bytes;
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
    throw new Error(
      `学习数据快照 ${(data.byteLength / 1_000_000).toFixed(1)} MB，`
      + `超过 ${MAX_UNCOMPRESSED_SNAPSHOT_BYTES / 1_000_000} MB 上限，云备份已停止。`
      + "本机数据完好，请在设置页导出本地备份并联系支持。"
    );
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
    throw new Error("当前系统版本无法解压云端学习数据（需要 iOS/Safari 16.4 以上），请升级后重试。");
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
        throw new Error(`云端学习数据解压后超过 ${MAX_UNCOMPRESSED_SNAPSHOT_BYTES / 1_000_000} MB，已停止处理。`);
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
