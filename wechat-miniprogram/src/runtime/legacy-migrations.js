/*
 * 0.1.x 小程序自己那套表 → 网页的表。**必须在 ensureSyncSchema 建触发器之前跑完。**
 *
 * 老小程序的 sync_tombstones 是 (entity, natural_key)，网页是 (table_name, row_key)。
 * `CREATE TABLE IF NOT EXISTS` 不会改已有的表，于是网页的删除触发器会往一张没有
 * table_name 列的表里写 —— 每次删行都报错，而且是在触发器里，调用方的事务整个被掀翻。
 */
const LEGACY_DAY_TABLES = ['direction_tasks', 'mode_tasks'];
const migrated = new WeakSet();

const columnsOf = (db, table) => {
  try { return new Set(db.exec(`PRAGMA table_info(${table})`)[0]?.values.map((row) => String(row[1])) || []); }
  catch { return new Set(); }
};
const tableExists = (db, table) => {
  const rows = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
  return Boolean(rows[0]?.values?.length);
};

function migrateTombstones(db) {
  if (!tableExists(db, 'sync_tombstones')) return;
  const columns = columnsOf(db, 'sync_tombstones');
  if (columns.has('table_name')) return;
  if (!columns.has('entity')) return;
  // ⚠️ reviews 的墓碑在老小程序里是三列自然键，而网页按 sync_uid 认。搬过去也对不上任何行，
  // 只会留一条永远命中不了的墓碑 —— 无害，所以照搬不挑。
  db.run('ALTER TABLE sync_tombstones RENAME TO sync_tombstones_legacy');
  db.run(`CREATE TABLE sync_tombstones (
    table_name TEXT NOT NULL,
    row_key TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    origin_device TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (table_name, row_key)
  )`);
  db.run(`INSERT OR IGNORE INTO sync_tombstones (table_name, row_key, deleted_at, origin_device)
    SELECT entity, natural_key, deleted_at, '' FROM sync_tombstones_legacy`);
  db.run('DROP TABLE sync_tombstones_legacy');
}

/*
 * 透传表：老小程序把看不懂的远端表整张存下来、导出时原样回放。现在这些表它全都认识
 * （建表来自网页的 local-schema），所以把存着的那一份放回真表里，再把透传表删掉。
 * 不放回去的话，这台设备推上去的快照会缺这些表，而云端只保留最近三代整库备份。
 */
function replayPassthrough(db) {
  if (!tableExists(db, 'sync_passthrough')) return;
  const rows = db.exec('SELECT table_name, columns_json, rows_json FROM sync_passthrough')[0]?.values || [];
  for (const [table, columnsJson, rowsJson] of rows) {
    if (!tableExists(db, String(table))) continue;
    let columns = [];
    let values = [];
    try { columns = JSON.parse(String(columnsJson)); values = JSON.parse(String(rowsJson)); } catch { continue; }
    const known = columnsOf(db, String(table));
    const usable = columns.filter((column) => known.has(column));
    if (!usable.length) continue;
    const indexes = usable.map((column) => columns.indexOf(column));
    const sql = `INSERT OR IGNORE INTO ${table} (${usable.join(', ')}) VALUES (${usable.map(() => '?').join(', ')})`;
    for (const row of values) db.run(sql, indexes.map((index) => row[index]));
  }
  db.run('DROP TABLE sync_passthrough');
}

/*
 * 成就表：老小程序叫 achievement_unlocked，网页 / App 叫 achievements（按 id 做 union 同步）。
 * 表名不一样 = 两端各解各的，谁也看不到对方解锁的成就，而且柚子按成就发钱也各发各的。
 */
function migrateAchievements(db) {
  if (!tableExists(db, 'achievement_unlocked')) return;
  db.run('CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, unlocked_on TEXT NOT NULL)');
  db.run('INSERT OR IGNORE INTO achievements (id, unlocked_on) SELECT id, unlocked_on FROM achievement_unlocked');
  db.run('DROP TABLE achievement_unlocked');
}

/** direction_tasks / mode_tasks 是老小程序自己发明的当日投影，网页没有这两张表。 */
function dropLegacyDayTables(db) {
  for (const table of LEGACY_DAY_TABLES) if (tableExists(db, table)) db.run(`DROP TABLE ${table}`);
}

function runLegacyMigrations(db) {
  if (migrated.has(db)) return;
  migrated.add(db);
  migrateTombstones(db);
  migrateAchievements(db);
  replayPassthrough(db);
  dropLegacyDayTables(db);
}

module.exports = { runLegacyMigrations };
