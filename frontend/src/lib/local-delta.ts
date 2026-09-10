/**
 * 本机落盘的增量。
 *
 * ## 为什么要有它
 *
 * 落盘一直是「整库 export 一份再写下去」。实测用户库 **35.9 MB**,而
 * `scheduleSave` 是 2 秒 debounce —— 真人节奏下等于**每答一张卡就整库重写一次**:
 * 浏览器端 `db.export()` + structuredClone 进 IndexedDB 占住主线程 100~510ms;
 * 原生端更糟,那条路还要先 base64(36MB → 48MB 字符串)再走三代文件轮转。
 *
 * ⚠️ **一个看着最诱人的方案是错的:把出厂词典拆出去并不解决问题。**
 * 实测 35.95 MB 里出厂数据(words / grammar_points / archive / kanji_units + 索引)
 * 只有 8.8 MB,用户数据 26 MB —— 光 reviews 加它的四个索引就 15.9 MB,
 * stage1_tasks 5.6 MB。拆完还剩 26 MB,而且只增不减。
 *
 * 所以整库快照必须**降频**,中间只写「上次快照之后改过的行」。
 *
 * ## 增量是白捡的
 *
 * 云同步早就给每张用户表加了 `sync_updated_at`(触发器盖章)和 `sync_tombstones`
 * (删除留墓碑),「上次快照之后改了哪些行」是现成的。这里没有第二套变更追踪,
 * 只是换个地方用同一份。回放也用同一套 `beginSyncApply` 把触发器压住 ——
 * 回放不是「新的本地改动」,不该重新盖时间戳,否则每次重启都会让云同步觉得
 * 整库都变过。
 *
 * ## 哪些改动**不**在增量里(读之前先看这条)
 *
 * 只有 SYNCED_TABLES 里的表带 sync_updated_at。运行期会写、又不在里面的只有
 * `words`:词单导入(新增行)和「合并重复词条」(删行)。这两条路必须自己喊一声
 * `requestFullSnapshot()`,否则重启后按快照+增量重建出来的库里,那些行还在。
 * 启动时的种子迁移和 shuffle_rank 回填也写 words,但它们每次启动都会幂等地再跑
 * 一遍,自愈,不用管。
 */

import { getDatabase } from "./database";
import { rowsFor, type DbRow, type SqlValue } from "./database/db-utils";
import { SYNCED_TABLES, type SyncedTable } from "./sync/tables";
import { beginSyncApply, endSyncApply, ensureSyncSchema, SYNC_UPDATED_COL } from "./sync/schema";

/** 墓碑里多列主键的分隔符,和 sync/schema.ts 的 rowKeyExpr 一致(char(31))。 */
const KEY_SEPARATOR = String.fromCharCode(31);

/** 快照自带的水位线:写在库里,所以它和快照天然是原子的,不用另存一个 mark 文件。 */
export const SNAPSHOT_MARK_KEY = "local_snapshot_mark";

export interface LocalDelta {
  /** 从哪一刻之后取的(只为排查) */
  from: string;
  /** 收集时刻。回放时拿它和快照自带的 mark 比大小,决定这条要不要放。 */
  to: string;
  rows: Record<string, DbRow[]>;
  tombstones: DbRow[];
}

const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/**
 * 一次问清楚有哪些表。逐张表去 sqlite_master 里问的话,收一次增量要问 34 遍,
 * 实测占 collectDelta 一多半的时间(12ms 里的 7ms)。
 */
const tableNames = (): Set<string> =>
  new Set(rowsFor("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name ?? "")));

const columnsOf = (table: string): Set<string> =>
  new Set(rowsFor(`PRAGMA table_info(${quote(table)})`).map((row) => String(row.name ?? "")));

/**
 * 用 SQLite 自己的时钟取水位线 —— 触发器盖的章就是这个表达式算出来的,
 * 换成 JS 的 Date 会引入一个「两个时钟差几毫秒」的缝。
 */
export const currentMark = (): string =>
  String(rowsFor("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS mark")[0]?.mark ?? "");

export const readSnapshotMark = (): string =>
  String(rowsFor("SELECT value FROM app_state WHERE key = ?", [SNAPSHOT_MARK_KEY])[0]?.value ?? "");

/** 整库导出之前调用:把这份快照的水位线写进它自己里面。 */
export const stampSnapshotMark = (mark: string): void => {
  getDatabase().run(
    "INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",
    [SNAPSHOT_MARK_KEY, mark]
  );
};

/**
 * 取 `since` 之后改过的行。
 *
 * ⚠️ 用 `>=` 不用 `>`:同一毫秒内写的行宁可多带一次。回放是 INSERT OR REPLACE,
 * 多带一份完全一样的数据不会有任何后果,漏带一行就是真丢数据。
 */
export const collectDelta = (since: string): LocalDelta => {
  ensureSyncSchema();
  const to = currentMark();
  const tables = tableNames();
  const rows: Record<string, DbRow[]> = {};
  for (const entry of SYNCED_TABLES) {
    if (!tables.has(entry.table)) continue;
    const changed = rowsFor(
      `SELECT * FROM ${quote(entry.table)} WHERE ${SYNC_UPDATED_COL} >= ?`,
      [since]
    );
    if (changed.length) rows[entry.table] = changed;
  }
  const tombstones = tables.has("sync_tombstones")
    ? rowsFor("SELECT * FROM sync_tombstones WHERE deleted_at >= ?", [since])
    : [];
  return { from: since, to, rows, tombstones };
};

export const deltaRowCount = (delta: LocalDelta): number =>
  Object.values(delta.rows).reduce((sum, list) => sum + list.length, 0) + delta.tombstones.length;

const upsert = (entry: SyncedTable, row: DbRow, columns: Set<string>): void => {
  const names = Object.keys(row).filter((name) => columns.has(name));
  if (!names.length) return;
  getDatabase().run(
    `INSERT OR REPLACE INTO ${quote(entry.table)} (${names.map(quote).join(", ")})
     VALUES (${names.map(() => "?").join(", ")})`,
    names.map((name) => row[name]) as SqlValue[]
  );
  // 这一行又活过来了,对应的墓碑就不能留 —— 平时靠 insert 触发器删,
  // 而回放全程 applying_remote 开着,触发器不跑,得自己来。
  const key = entry.keys.map((name) => String(row[name] ?? "")).join(KEY_SEPARATOR);
  getDatabase().run(
    "DELETE FROM sync_tombstones WHERE table_name = ? AND row_key = ?",
    [entry.table, key]
  );
};

const applyTombstone = (stone: DbRow, tables: Set<string>): void => {
  const table = String(stone.table_name ?? "");
  const key = String(stone.row_key ?? "");
  const entry = SYNCED_TABLES.find((item) => item.table === table);
  if (entry && tables.has(table)) {
    const values = key.split(KEY_SEPARATOR);
    // 主键列数对不上就只留墓碑不删行:宁可多留一行,也不能按半截键删错东西。
    if (values.length === entry.keys.length) {
      getDatabase().run(
        `DELETE FROM ${quote(table)} WHERE ${entry.keys.map((name) => `${quote(name)} = ?`).join(" AND ")}`,
        values as SqlValue[]
      );
    }
  }
  getDatabase().run(
    `INSERT OR REPLACE INTO sync_tombstones (table_name, row_key, deleted_at, origin_device)
     VALUES (?, ?, ?, ?)`,
    [table, key, String(stone.deleted_at ?? ""), String(stone.origin_device ?? "")]
  );
};

/**
 * 回放。**先墓碑后行**:同一条增量里一个键既被删又被写(删掉再插回来)时,
 * 最终状态应该是「在」,反过来会把刚插回去的行又删掉。
 *
 * ⚠️ **整条增量是一个事务**。`beginSyncApply()` 只是把同步触发器压住,它不是
 * BEGIN TRANSACTION —— 没有事务的话,中途某一行写不下去(表结构对不上、约束冲突)
 * 会留下一份「放了一半」的库:前面的行已经生效、后面的没有,而启动代码只在控制台
 * 警告一句「已按快照那一刻启动」。要么整条放进去,要么整条不放。
 */
export const applyDelta = (delta: LocalDelta): void => {
  ensureSyncSchema();
  beginSyncApply();
  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    const tables = tableNames();
    for (const stone of delta.tombstones) applyTombstone(stone, tables);
    for (const entry of SYNCED_TABLES) {
      const incoming = delta.rows[entry.table];
      if (!incoming?.length || !tables.has(entry.table)) continue;
      const columns = columnsOf(entry.table);
      for (const row of incoming) upsert(entry, row, columns);
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  } finally {
    endSyncApply();
  }
};
