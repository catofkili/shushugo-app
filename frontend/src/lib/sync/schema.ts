// 增量同步所需的本地表结构改造(幂等,可在旧库上反复执行)。
//
// 变更追踪不靠改写业务代码,而是靠 SQLite 触发器:任何一处 INSERT/UPDATE 都会
// 自动盖上 sync_updated_at,DELETE 会自动写墓碑。这样即使以后新增写入路径,
// 也不会因为「忘了打时间戳」而漏同步。
//
// 依赖 SQLite 默认关闭 recursive_triggers:触发器内部的 UPDATE 不会再次触发自己。

import { getDatabase } from "../database";
import { firstRow, firstValue, rowsFor, setState } from "../database/db-utils";
import { hashSchemaDefinition, hasSchemaFingerprint, saveSchemaFingerprint } from "../database/schema-fingerprint";
import { backfillStudyTimeByDevice } from "./study-time";
import { SYNCED_TABLES, STUDY_TIME_TABLE, type SyncedTable } from "./tables";

export const SYNC_UPDATED_COL = "sync_updated_at";
export const SYNC_UID_COL = "sync_uid";
export const SYNC_ORIGIN_COL = "sync_origin_device";

/** UTC + 毫秒,字典序即时间序,便于按游标比较。 */
const NOW_EXPR = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const schemaReadyDbs = new WeakSet<object>();
export const SYNC_SCHEMA_FINGERPRINT_KEY = "runtime_schema_sync_ddl";

/** A user-table migration can add a synced table after delta replay initialized this schema. */
export function invalidateSyncSchema(): void {
  const db = getDatabase();
  schemaReadyDbs.delete(db);
  setState(SYNC_SCHEMA_FINGERPRINT_KEY, "");
}

const columnsOf = (table: string): Set<string> =>
  new Set(rowsFor(`PRAGMA table_info(${table})`).map((row) => String(row.name ?? "")));

const tableExists = (table: string): boolean =>
  rowsFor("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]).length > 0;

/** 把主键列拼成一个字符串行标识;char(31) 是不会出现在数据里的分隔符。 */
const rowKeyExpr = (entry: SyncedTable, alias: "OLD" | "NEW"): string =>
  entry.keys.map((key) => `CAST(${alias}.${key} AS TEXT)`).join(" || char(31) || ");

/**
 * 小程序 0.1.x 的 reverse_memory / kanji_reading_memory 还带旧评分/掌握字段，它推上云的
 * 快照里就有这些列。Web 不消费它们，但 merge.ts 的 assertSnapshotWritable 会拒绝「本机存不下
 * 的列」，不补上的话，任何一个用过旧小程序的账号整次同步都会被拒。
 * （2026-09-23 合入 9-17 那批同步修复时曾当成过时删掉，sync-snapshot-smoke 当场红了。）
 * merge 在做能力检查前也会调一次：表可能是在 ensureSyncSchema 之后才建出来的。
 */
export function ensureLegacyMemoryColumns(table: string): void {
  const db = getDatabase();
  for (const statement of legacyMemoryColumnStatements(table)) db.run(statement);
}

const legacyMemoryColumnStatements = (table: string, knownColumns?: Set<string>): string[] => {
  if (table !== "reverse_memory" && table !== "kanji_reading_memory") return [];
  if (!knownColumns && !tableExists(table)) return [];
  const columns = knownColumns ?? columnsOf(table);
  const compatibilityColumns = {
    score: "INTEGER NOT NULL DEFAULT 0", low_history: "INTEGER NOT NULL DEFAULT 0",
    known_forever: "INTEGER NOT NULL DEFAULT 0", mastered_on: "TEXT",
    mistake_streak: "INTEGER NOT NULL DEFAULT 0", last_decay_amount: "INTEGER DEFAULT 10",
    right_streak: "INTEGER NOT NULL DEFAULT 0", auto_retired_on: "TEXT"
  };
  return Object.entries(compatibilityColumns)
    .filter(([column]) => !columns.has(column))
    .map(([column, definition]) => `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

export function ensureSyncSchema(): void {
  const db = getDatabase();
  if (schemaReadyDbs.has(db)) return;
  const fingerprint = syncSchemaFingerprint();
  const schemaMatches = hasSchemaFingerprint(SYNC_SCHEMA_FINGERPRINT_KEY, fingerprint);

  if (!schemaMatches) {
    ensureSyncStructure();
  }
  // 合并途中 App 被杀时 endSyncApply 跑不到。即使 DDL 指纹匹配，这个恢复标志也
  // 必须每次冷启动清掉；它是数据修复，不属于可跳过的结构 SQL。
  db.run("DELETE FROM sync_context WHERE key = 'applying_remote'");

  // 云端合并在 applying_remote 下进行，插入触发器不会给新行补 uid / 来源。
  // 每次冷启动仍探测一次，但先查索引中的缺失项，整表 UPDATE 只在确有缺口时执行。
  backfillMissingSyncMetadata();
  if (!schemaMatches) {
    saveSchemaFingerprint(SYNC_SCHEMA_FINGERPRINT_KEY, syncSchemaFingerprint());
  }
  schemaReadyDbs.add(db);

  // by_device 表之前的学习时长只存在 word_study_time 里,补一行记在本设备名下。
  // 必须放在 schemaReadyDbs 之后:它内部会再进 ensureSyncSchema,不然会死循环。
  if (tableExists("word_study_time")) backfillStudyTimeByDevice();
}

const syncSchemaFingerprint = (): string => {
  const tables = new Set(rowsFor("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name)));
  return hashSchemaDefinition([
    syncSchemaDdlStatements(),
    SYNCED_TABLES.filter((entry) => tables.has(entry.table)).map((entry) => entry.table)
  ]);
};

/**
 * Runtime-built DDL is the cache key. Trigger bodies, indexes, and compatibility ALTERs
 * are the same strings executed below; moving SQL into this plan makes edits invalidate
 * the database marker without a manually bumped schema version.
 */
function syncSchemaDdlStatements(): string[] {
  const statements = [
    "CREATE TABLE IF NOT EXISTS sync_device (id TEXT NOT NULL)",
    `CREATE TABLE IF NOT EXISTS sync_context (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sync_tombstones (
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      origin_device TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (table_name, row_key)
    )`,
    `CREATE TABLE IF NOT EXISTS ${STUDY_TIME_TABLE} (
      studied_on TEXT NOT NULL,
      device_id TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      ${SYNC_UPDATED_COL} TEXT,
      PRIMARY KEY (studied_on, device_id)
    )`,
    `CREATE TABLE IF NOT EXISTS weekly_reports (
      week_start TEXT PRIMARY KEY,
      week_end TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 3,
      content_json TEXT NOT NULL,
      read_at INTEGER,
      source_revision TEXT,
      sync_updated_at TEXT,
      sync_origin_device TEXT
    )`
  ];

  statements.push("ALTER TABLE sync_tombstones ADD COLUMN origin_device TEXT NOT NULL DEFAULT ''");

  for (const entry of SYNCED_TABLES) {
    if (entry.table === "reviews") statements.push(
      "ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'",
      "ALTER TABLE reviews ADD COLUMN reviewed_at INTEGER",
      "ALTER TABLE reviews ADD COLUMN scheduler_mode TEXT NOT NULL DEFAULT 'legacy'",
      "ALTER TABLE reviews ADD COLUMN fsrs_params_version TEXT NOT NULL DEFAULT 'legacy'",
      "ALTER TABLE reviews ADD COLUMN event_source TEXT NOT NULL DEFAULT 'legacy'"
    );
    statements.push(...legacyMemoryColumnStatements(entry.table, new Set()));
    statements.push(...trackingDdlStatements(entry, new Set()));
    statements.push(...triggerDdlStatements(entry));
  }
  return statements;
}

function ensureSyncStructure(): void {
  const db = getDatabase();
  const baseDdlCount = 5;
  const ddl = syncSchemaDdlStatements();
  for (const statement of ddl.slice(0, baseDdlCount)) db.run(statement);
  getDeviceId();

  if (!columnsOf("sync_tombstones").has("origin_device")) {
    db.run("ALTER TABLE sync_tombstones ADD COLUMN origin_device TEXT NOT NULL DEFAULT ''");
  }
  for (const entry of SYNCED_TABLES) {
    if (!tableExists(entry.table)) continue;
    const columns = columnsOf(entry.table);
    if (entry.table === "reviews") {
      if (!columns.has("direction")) db.run("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'");
      if (!columns.has("reviewed_at")) db.run("ALTER TABLE reviews ADD COLUMN reviewed_at INTEGER");
      if (!columns.has("scheduler_mode")) db.run("ALTER TABLE reviews ADD COLUMN scheduler_mode TEXT NOT NULL DEFAULT 'legacy'");
      if (!columns.has("fsrs_params_version")) db.run("ALTER TABLE reviews ADD COLUMN fsrs_params_version TEXT NOT NULL DEFAULT 'legacy'");
      if (!columns.has("event_source")) db.run("ALTER TABLE reviews ADD COLUMN event_source TEXT NOT NULL DEFAULT 'legacy'");
    }
    for (const statement of legacyMemoryColumnStatements(entry.table, columns)) db.run(statement);
    for (const statement of trackingDdlStatements(entry, columns)) db.run(statement);
    for (const statement of triggerDdlStatements(entry)) db.run(statement);
  }
}

function backfillMissingSyncMetadata(): void {
  const db = getDatabase();
  for (const entry of SYNCED_TABLES) {
    if (!tableExists(entry.table)) continue;
    const missing = firstRow(
      `SELECT
         ${entry.strategy === "append"
        ? `EXISTS (SELECT 1 FROM ${entry.table} WHERE ${SYNC_UID_COL} IS NULL LIMIT 1)`
        : "0"} AS uid,
         EXISTS (SELECT 1 FROM ${entry.table} WHERE ${SYNC_UPDATED_COL} IS NULL LIMIT 1) AS updated,
         EXISTS (SELECT 1 FROM ${entry.table}
                WHERE ${SYNC_ORIGIN_COL} IS NULL OR ${SYNC_ORIGIN_COL} = '' LIMIT 1) AS origin`
    );
    if (Number(missing?.uid)) {
      db.run(
        `UPDATE ${entry.table}
         SET ${SYNC_UID_COL} = (SELECT id FROM sync_device LIMIT 1) || ':' || CAST(id AS TEXT)
         WHERE ${SYNC_UID_COL} IS NULL`
      );
    }
    if (Number(missing?.updated)) {
      db.run(
        `UPDATE ${entry.table} SET ${SYNC_UPDATED_COL} = '1970-01-01T00:00:00.000Z'
         WHERE ${SYNC_UPDATED_COL} IS NULL`
      );
    }
    if (Number(missing?.origin)) {
      db.run(
        `UPDATE ${entry.table} SET ${SYNC_ORIGIN_COL} = (SELECT id FROM sync_device LIMIT 1)
         WHERE ${SYNC_ORIGIN_COL} IS NULL OR ${SYNC_ORIGIN_COL} = ''`
      );
    }
  }
}

const trackingDdlStatements = (entry: SyncedTable, columns: Set<string>): string[] => {
  const statements: string[] = [];
  if (!columns.has(SYNC_UPDATED_COL)) {
    statements.push(`ALTER TABLE ${entry.table} ADD COLUMN ${SYNC_UPDATED_COL} TEXT`);
  }
  if (!columns.has(SYNC_ORIGIN_COL)) {
    statements.push(`ALTER TABLE ${entry.table} ADD COLUMN ${SYNC_ORIGIN_COL} TEXT`);
  }

  if (entry.strategy === "append") {
    if (!columns.has(SYNC_UID_COL)) {
      // 两端可能从同一份存档继承相同的自增 id；事件身份必须与它解耦。
      // 旧行仍按设备号:本地 id 回填，新写入由触发器生成设备号:随机尾段。
      statements.push(`ALTER TABLE ${entry.table} ADD COLUMN ${SYNC_UID_COL} TEXT`);
    }
    statements.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${entry.table}_sync_uid
       ON ${entry.table}(${SYNC_UID_COL})`
    );
  }

  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${entry.table}_sync_updated
     ON ${entry.table}(${SYNC_UPDATED_COL})`
  );
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${entry.table}_sync_origin_missing
     ON ${entry.table}(${SYNC_ORIGIN_COL})
     WHERE ${SYNC_ORIGIN_COL} IS NULL OR ${SYNC_ORIGIN_COL} = ''`
  );
  return statements;
};

const triggerDdlStatements = (entry: SyncedTable): string[] => {
  const { table } = entry;
  const uidAssign = entry.strategy === "append"
    ? `, ${SYNC_UID_COL} = COALESCE(NEW.${SYNC_UID_COL},
         (SELECT id FROM sync_device LIMIT 1) || ':' || lower(hex(randomblob(16))))`
    : "";

  // 触发器定义会随着同步协议升级而变化,不能只依赖 IF NOT EXISTS;
  // 否则旧版本留下的触发器会继续绕过 remote apply 上下文。
  const statements = [
    `DROP TRIGGER IF EXISTS trg_${table}_sync_insert`,
    `DROP TRIGGER IF EXISTS trg_${table}_sync_update`,
    `DROP TRIGGER IF EXISTS trg_${table}_sync_delete`
  ];

  statements.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_insert AFTER INSERT ON ${table}
    WHEN NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
    BEGIN
      UPDATE ${table} SET ${SYNC_UPDATED_COL} = ${NOW_EXPR},
        ${SYNC_ORIGIN_COL} = (SELECT id FROM sync_device LIMIT 1)${uidAssign}
      WHERE rowid = NEW.rowid;
      DELETE FROM sync_tombstones
      WHERE table_name = '${table}' AND row_key = ${rowKeyExpr(entry, "NEW")};
    END
  `);

  // 只在业务列真的变了时盖章;同步写回自身时间戳不应再算一次变更。
  statements.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_update AFTER UPDATE ON ${table}
    WHEN NEW.${SYNC_UPDATED_COL} IS OLD.${SYNC_UPDATED_COL}
      AND NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
    BEGIN
      UPDATE ${table} SET ${SYNC_UPDATED_COL} = ${NOW_EXPR},
        ${SYNC_ORIGIN_COL} = (SELECT id FROM sync_device LIMIT 1)
      WHERE rowid = NEW.rowid;
    END
  `);

  // 没有墓碑的话,一端删掉的行会被另一端的旧数据原样复活。
  statements.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_delete AFTER DELETE ON ${table}
    WHEN NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
      -- 算不出 row_key 的行(某列是 NULL)写不了墓碑 —— 但那也不该让调用方的事务
      -- 整个失败。没有同步身份的行本来就不可能被对端按键复活,跳过是安全的;
      -- 抛错则会把「合并重复词条」这种一整个批量迁移掀翻。上面的 uid 回填负责
      -- 让这条守卫平时用不上。
      AND ${rowKeyExpr(entry, "OLD")} IS NOT NULL
    BEGIN
      INSERT INTO sync_tombstones (table_name, row_key, deleted_at, origin_device)
      VALUES ('${table}', ${rowKeyExpr(entry, "OLD")}, ${NOW_EXPR},
        (SELECT id FROM sync_device LIMIT 1))
      ON CONFLICT(table_name, row_key) DO UPDATE SET
        deleted_at = excluded.deleted_at,
        origin_device = excluded.origin_device;
    END
  `);
  return statements;
};

export function beginSyncApply(): void {
  ensureSyncSchema();
  getDatabase().run("INSERT OR REPLACE INTO sync_context (key, value) VALUES ('applying_remote', '1')");
}

export function endSyncApply(): void {
  getDatabase().run("DELETE FROM sync_context WHERE key = 'applying_remote'");
}

/**
 * 跑一段「不算本地改动」的写入：占位行(progress / grammar_progress 的空行)。
 *
 * ⚠️ 这些行不盖 sync_updated_at 是**必须的**：它们的合并策略是 LWW，而占位行的
 * 「现在」比云端那条真学过的行新，合并之后云端的学习状态会被一行空记录静默盖掉
 * （现象：换台设备打开，学过的词变回未学）。留空 = 纪元，任何真实记录都赢得过它。
 *
 * 嵌套安全：已经在 applying_remote 里的话原样跑完，不提前把标志清掉。
 */
export function withoutSyncStamp<T>(run: () => T): T {
  ensureSyncSchema();
  const alreadyApplying = firstValue<string>(
    "SELECT value FROM sync_context WHERE key = 'applying_remote'",
    [],
    ""
  ) === "1";
  if (alreadyApplying) return run();
  beginSyncApply();
  try {
    return run();
  } finally {
    endSyncApply();
  }
}

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
