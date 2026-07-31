// 增量同步所需的本地表结构改造(幂等,可在旧库上反复执行)。
//
// 变更追踪不靠改写业务代码,而是靠 SQLite 触发器:任何一处 INSERT/UPDATE 都会
// 自动盖上 sync_updated_at,DELETE 会自动写墓碑。这样即使以后新增写入路径,
// 也不会因为「忘了打时间戳」而漏同步。
//
// 依赖 SQLite 默认关闭 recursive_triggers:触发器内部的 UPDATE 不会再次触发自己。

import { getDatabase } from "../database";
import { rowsFor } from "../database/db-utils";
import { SYNCED_TABLES, STUDY_TIME_TABLE, type SyncedTable } from "./tables";

export const SYNC_UPDATED_COL = "sync_updated_at";
export const SYNC_UID_COL = "sync_uid";

/** UTC + 毫秒,字典序即时间序,便于按游标比较。 */
const NOW_EXPR = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const schemaReadyDbs = new WeakSet<object>();

const columnsOf = (table: string): Set<string> =>
  new Set(rowsFor(`PRAGMA table_info(${table})`).map((row) => String(row.name ?? "")));

const tableExists = (table: string): boolean =>
  rowsFor("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]).length > 0;

/** 把主键列拼成一个字符串行标识;char(31) 是不会出现在数据里的分隔符。 */
const rowKeyExpr = (entry: SyncedTable, alias: "OLD" | "NEW"): string =>
  entry.keys.map((key) => `CAST(${alias}.${key} AS TEXT)`).join(" || char(31) || ");

export function ensureSyncSchema(): void {
  const db = getDatabase();
  if (schemaReadyDbs.has(db)) return;

  // 设备标识存表里而不是烤进触发器,否则从别的设备恢复备份后,
  // 触发器会继续用对端的设备号给本机新数据打标。
  db.run("CREATE TABLE IF NOT EXISTS sync_device (id TEXT NOT NULL)");

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, row_key)
    )
  `);

  // 每天每设备一行,避免两端同日学习时求和重复累加。
  db.run(`
    CREATE TABLE IF NOT EXISTS ${STUDY_TIME_TABLE} (
      studied_on TEXT NOT NULL,
      device_id TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      ${SYNC_UPDATED_COL} TEXT,
      PRIMARY KEY (studied_on, device_id)
    )
  `);

  for (const entry of SYNCED_TABLES) {
    if (!tableExists(entry.table)) continue;
    ensureTrackingColumns(entry);
    ensureTriggers(entry);
  }

  schemaReadyDbs.add(db);
}

const ensureTrackingColumns = (entry: SyncedTable): void => {
  const db = getDatabase();
  const columns = columnsOf(entry.table);

  if (!columns.has(SYNC_UPDATED_COL)) {
    db.run(`ALTER TABLE ${entry.table} ADD COLUMN ${SYNC_UPDATED_COL} TEXT`);
  }

  if (entry.strategy === "append" && !columns.has(SYNC_UID_COL)) {
    // 两端的自增 id 会撞车(各自都会产生 id=5001),所以事件日志另立
    // 「设备号:本地 id」作为全局唯一键,合并时按它去重。
    db.run(`ALTER TABLE ${entry.table} ADD COLUMN ${SYNC_UID_COL} TEXT`);
    db.run(
      `UPDATE ${entry.table}
       SET ${SYNC_UID_COL} = (SELECT id FROM sync_device LIMIT 1) || ':' || CAST(id AS TEXT)
       WHERE ${SYNC_UID_COL} IS NULL`
    );
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${entry.table}_sync_uid
       ON ${entry.table}(${SYNC_UID_COL})`
    );
  }

  // 存量行标成「远古」,这样首次同步会把它们全部推上去,而不是被当成无变更跳过。
  db.run(
    `UPDATE ${entry.table} SET ${SYNC_UPDATED_COL} = '1970-01-01T00:00:00.000Z'
     WHERE ${SYNC_UPDATED_COL} IS NULL`
  );

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_${entry.table}_sync_updated
     ON ${entry.table}(${SYNC_UPDATED_COL})`
  );
};

const ensureTriggers = (entry: SyncedTable): void => {
  const db = getDatabase();
  const { table } = entry;
  const uidAssign = entry.strategy === "append"
    ? `, ${SYNC_UID_COL} = COALESCE(NEW.${SYNC_UID_COL},
         (SELECT id FROM sync_device LIMIT 1) || ':' || CAST(NEW.id AS TEXT))`
    : "";

  db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_insert AFTER INSERT ON ${table}
    BEGIN
      UPDATE ${table} SET ${SYNC_UPDATED_COL} = ${NOW_EXPR}${uidAssign}
      WHERE rowid = NEW.rowid;
      DELETE FROM sync_tombstones
      WHERE table_name = '${table}' AND row_key = ${rowKeyExpr(entry, "NEW")};
    END
  `);

  // 只在业务列真的变了时盖章;同步写回自身时间戳不应再算一次变更。
  db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_update AFTER UPDATE ON ${table}
    WHEN NEW.${SYNC_UPDATED_COL} IS OLD.${SYNC_UPDATED_COL}
    BEGIN
      UPDATE ${table} SET ${SYNC_UPDATED_COL} = ${NOW_EXPR} WHERE rowid = NEW.rowid;
    END
  `);

  // 没有墓碑的话,一端删掉的行会被另一端的旧数据原样复活。
  db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_delete AFTER DELETE ON ${table}
    BEGIN
      INSERT INTO sync_tombstones (table_name, row_key, deleted_at)
      VALUES ('${table}', ${rowKeyExpr(entry, "OLD")}, ${NOW_EXPR})
      ON CONFLICT(table_name, row_key) DO UPDATE SET deleted_at = excluded.deleted_at;
    END
  `);
};

/** 本机设备号;首次调用时生成并落库。恢复他人备份后需调用 resetDeviceId。 */
export function getDeviceId(): string {
  const db = getDatabase();
  db.run("CREATE TABLE IF NOT EXISTS sync_device (id TEXT NOT NULL)");
  const existing = rowsFor("SELECT id FROM sync_device LIMIT 1");
  if (existing.length) return String(existing[0].id);

  const id = crypto.randomUUID();
  db.run("INSERT INTO sync_device (id) VALUES (?)", [id]);
  return id;
}

/**
 * 导入云端/他人备份后调用:备份里带着来源设备的设备号,
 * 若不换掉,本机之后产生的复习记录会和来源设备的 sync_uid 撞车。
 */
export function resetDeviceId(): string {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.run("DELETE FROM sync_device");
  db.run("INSERT INTO sync_device (id) VALUES (?)", [id]);
  return id;
}
