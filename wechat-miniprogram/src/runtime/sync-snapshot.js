/*
 * 与 cloudflare-sync / frontend 共用的「只含用户数据」SQLite 快照。
 *
 * 词典和音频永远不进快照：它们由内容版本提供。快照只复制小程序当前
 * 能理解的用户表，并按目标库现有列求交集，因此 iOS 端新增的同步辅助列
 * 不会让小程序导入失败。
 */
const core = require('../core/study-core');
const { getDeviceId } = require('../core/sync-protocol');

const SYNC_SNAPSHOT_FORMAT = 'master-nihongo-user-sqlite-v1';
const SYNC_PROTOCOL_VERSION = 1;
const META_TABLE = 'sync_snapshot_meta';
const SNAPSHOT_TABLES = [
  'progress',
  'reverse_memory',
  'kanji_reading_memory',
  'word_notes',
  'stage1_tasks',
  'direction_tasks',
  'reviews',
  'checkins',
  'app_state',
  'confusion_mastered',
  'achievement_unlocked',
  'sync_tombstones'
];
const LOCAL_STATE_KEYS = new Set([
  'sync_device_id',
  'sync_cursor',
  'sync_last_pushed_at',
  'sync_generation',
  'sync_last_modified',
  'auth_access_token',
  'auth_user_id',
  'entitlement_cache'
]);
const TOMBSTONE_COLUMNS = ['table_name', 'row_key', 'deleted_at', 'origin_device', 'entity', 'natural_key'];

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function tableExists(db, table) {
  return Boolean(core.firstValue(
    db,
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    [table],
    0
  ));
}

function columnsOf(db, table) {
  return core.rowsFor(db, `PRAGMA table_info(${quoteIdentifier(table)})`)
    .map((row) => String(row.name));
}

function syncTimestamp(table, row, columns) {
  const values = [
    row[columns.indexOf('sync_updated_at')],
    row[columns.indexOf('fsrs_last_review')],
    row[columns.indexOf('updated_at')],
    row[columns.indexOf('created_at')],
    row[columns.indexOf('reviewed_on')],
    row[columns.indexOf('study_day')],
    row[columns.indexOf('checked_on')],
    row[columns.indexOf('last_seen_on')]
  ];
  return values.find((value) => value != null && String(value) !== '') || '1970-01-01T00:00:00.000Z';
}

function copyTable(source, target, table, originDevice) {
  if (!tableExists(source, table)) return;
  const createSql = core.firstValue(
    source,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
    ''
  );
  if (!createSql) throw new Error(`无法导出同步表结构：${table}`);
  target.run(createSql);
  const columns = columnsOf(source, table);
  // iOS 的逐行合并依赖这两列来判断同一自然键的较新版本。小程序本地
  // 表保持轻量，不强制迁移；导出时在快照表中补上可解释的时间和设备号。
  const snapshotColumns = [...columns];
  if (!snapshotColumns.includes('sync_updated_at')) {
    target.run(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN sync_updated_at TEXT`);
    snapshotColumns.push('sync_updated_at');
  }
  if (!snapshotColumns.includes('sync_origin_device')) {
    target.run(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN sync_origin_device TEXT`);
    snapshotColumns.push('sync_origin_device');
  }
  const excludes = table === 'app_state' ? [...LOCAL_STATE_KEYS] : [];
  const where = excludes.length
    ? ` WHERE key NOT IN (${excludes.map(() => '?').join(', ')})`
    : '';
  const statement = source.prepare(`SELECT * FROM ${quoteIdentifier(table)}${where}`);
  const rows = [];
  try {
    if (excludes.length) statement.bind(excludes);
    while (statement.step()) rows.push(statement.get());
  } finally {
    statement.free();
  }
  if (!rows.length) return;
  const quoted = snapshotColumns.map(quoteIdentifier).join(', ');
  const placeholders = snapshotColumns.map(() => '?').join(', ');
  target.run('BEGIN');
  try {
    const insert = `INSERT INTO ${quoteIdentifier(table)} (${quoted}) VALUES (${placeholders})`;
    for (const row of rows) target.run(insert, [
      ...row,
      ...(columns.includes('sync_updated_at') ? [] : [syncTimestamp(table, row, columns)]),
      ...(columns.includes('sync_origin_device') ? [] : [originDevice])
    ]);
    target.run('COMMIT');
  } catch (error) {
    target.run('ROLLBACK');
    throw error;
  }
}

// iOS 端历史上使用 table_name/row_key，小程序协议使用 entity/natural_key。
// 快照保留两套别名，令任一端都能读到另一端的删除，而不要求同时升级。
function copyTombstones(source, target) {
  if (!tableExists(source, 'sync_tombstones')) return;
  target.run(`CREATE TABLE ${quoteIdentifier('sync_tombstones')} (
    table_name TEXT,
    row_key TEXT,
    deleted_at TEXT NOT NULL,
    origin_device TEXT NOT NULL DEFAULT '',
    entity TEXT,
    natural_key TEXT
  )`);
  const columns = columnsOf(source, 'sync_tombstones');
  const statement = source.prepare(`SELECT * FROM ${quoteIdentifier('sync_tombstones')}`);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.get());
  } finally {
    statement.free();
  }
  if (!rows.length) return;
  const read = (row, name) => row[columns.indexOf(name)];
  target.run('BEGIN');
  try {
    for (const row of rows) {
      const table = String(read(row, 'table_name') ?? read(row, 'entity') ?? '');
      const key = String(read(row, 'row_key') ?? read(row, 'natural_key') ?? '');
      const deletedAt = String(read(row, 'deleted_at') || '1970-01-01T00:00:00.000Z');
      const origin = String(read(row, 'origin_device') || '');
      target.run(`INSERT INTO ${quoteIdentifier('sync_tombstones')}
        (${TOMBSTONE_COLUMNS.map(quoteIdentifier).join(', ')}) VALUES (?, ?, ?, ?, ?, ?)`,
      [table, key, deletedAt, origin, table, key]);
    }
    target.run('COMMIT');
  } catch (error) {
    target.run('ROLLBACK');
    throw error;
  }
}

async function exportSyncSnapshot(db) {
  core.ensureStudySchema(db);
  // 使用同一个 sql.js Database 构造器，导出逻辑不依赖 wx/WASM 加载器，
  // 因此可以在 Node 回归测试中直接跑真实种子库。
  const snapshot = new (db.constructor)();
  try {
    snapshot.run(`CREATE TABLE ${META_TABLE} (format TEXT PRIMARY KEY, protocol_version INTEGER NOT NULL)`);
    snapshot.run(`INSERT INTO ${META_TABLE} (format, protocol_version) VALUES (?, ?)`, [
      SYNC_SNAPSHOT_FORMAT,
      SYNC_PROTOCOL_VERSION
    ]);
    const originDevice = getDeviceId(db);
    for (const table of SNAPSHOT_TABLES) {
      if (table === 'sync_tombstones') copyTombstones(db, snapshot);
      else copyTable(db, snapshot, table, originDevice);
    }
    return new Uint8Array(snapshot.export());
  } finally {
    snapshot.close();
  }
}

function validateSnapshot(db) {
  const format = core.firstValue(db, `SELECT format FROM ${META_TABLE} LIMIT 1`, [], null);
  const version = core.firstValue(db, `SELECT protocol_version FROM ${META_TABLE} LIMIT 1`, [], null);
  if (format !== SYNC_SNAPSHOT_FORMAT || Number(version) !== SYNC_PROTOCOL_VERSION) {
    throw new Error('云端学习数据版本不兼容，已保留本机数据');
  }
}

function targetColumns(db, table, source) {
  const wanted = new Set(columnsOf(db, table));
  return columnsOf(source, table).filter((column) => wanted.has(column));
}

function sourceRows(db, table, columns) {
  if (!columns.length) return [];
  const statement = db.prepare(`SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table)}`);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.get());
  } finally {
    statement.free();
  }
  return rows;
}

function rowBy(db, table, keyColumns, values) {
  if (!tableExists(db, table)) return null;
  const where = keyColumns.map((key) => `${quoteIdentifier(key)} IS ?`).join(' AND ');
  return core.rowsFor(db, `SELECT * FROM ${quoteIdentifier(table)} WHERE ${where} LIMIT 1`, values)[0] || null;
}

function upsertRaw(db, table, columns, row, conflictColumns) {
  const quotedColumns = columns.map(quoteIdentifier).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map((column, index) => row[index]);
  const primaryKey = core.rowsFor(db, `PRAGMA table_info(${quoteIdentifier(table)})`)
    .filter((item) => Number(item.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((item) => String(item.name));
  if (primaryKey.length > 0 && primaryKey.join('\u0000') === conflictColumns.join('\u0000')) {
    const updates = columns
      .filter((column) => !conflictColumns.includes(column))
      .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
      .join(', ');
    if (updates) {
      db.run(
        `INSERT INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES (${placeholders})
         ON CONFLICT (${conflictColumns.map(quoteIdentifier).join(', ')}) DO UPDATE SET ${updates}`,
        values
      );
      return;
    }
  }
  db.run(`INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES (${placeholders})`, values);
}

function tombstoneRows(db) {
  if (!tableExists(db, 'sync_tombstones')) return [];
  const columns = columnsOf(db, 'sync_tombstones');
  return sourceRows(db, 'sync_tombstones', columns).map((row) => {
    const get = (name) => row[columns.indexOf(name)];
    const entity = String(get('entity') ?? get('table_name') ?? '');
    const naturalKey = String(get('natural_key') ?? get('row_key') ?? '');
    return {
      entity,
      naturalKey,
      deletedAt: String(get('deleted_at') || '1970-01-01T00:00:00.000Z'),
      originDevice: String(get('origin_device') || '')
    };
  }).filter((row) => row.entity && row.naturalKey);
}

function tombstoneKeyColumns(entity) {
  return entity === 'stage1_tasks' ? ['reviewed_on', 'word_id']
    : entity === 'direction_tasks' ? ['study_day', 'direction', 'word_id']
      : entity === 'reviews' ? ['word_id', 'created_at', 'direction']
        : entity === 'checkins' ? ['checked_on']
          : entity === 'app_state' ? ['key']
            : entity === 'confusion_mastered' ? ['group_key']
              : entity === 'achievement_unlocked' ? ['id']
                : ['word_id'];
}

function applyTombstone(db, tombstone) {
  const table = tombstone.entity;
  if (!tableExists(db, table)) return false;
  const keys = tombstoneKeyColumns(table);
  const values = tombstone.naturalKey.split('\u001f');
  if (values.length !== keys.length) return false;
  const where = keys.map((key) => `${quoteIdentifier(key)} IS ?`).join(' AND ');
  const local = core.rowsFor(db, `SELECT * FROM ${quoteIdentifier(table)} WHERE ${where} LIMIT 1`, values)[0];
  if (!local) return false;
  const columns = columnsOf(db, table);
  const localChanged = syncTimestamp(table, local, columns);
  if (String(localChanged) > String(tombstone.deletedAt)) return false;
  db.run(`DELETE FROM ${quoteIdentifier(table)} WHERE ${where}`, values);
  return true;
}

function mergeTombstones(db, remote) {
  const incoming = tombstoneRows(remote);
  let deleted = 0;
  for (const tombstone of incoming) {
    if (applyTombstone(db, tombstone)) deleted += 1;
    const existing = tombstoneRows(db).find((row) => row.entity === tombstone.entity && row.naturalKey === tombstone.naturalKey);
    if (!existing || String(tombstone.deletedAt) > String(existing.deletedAt)) {
      db.run(`INSERT OR REPLACE INTO sync_tombstones (entity, natural_key, deleted_at) VALUES (?, ?, ?)`, [
        tombstone.entity, tombstone.naturalKey, tombstone.deletedAt
      ]);
    }
  }
  return deleted;
}

function mergeMemory(db, table, row) {
  const wordId = Number(row.word_id);
  if (!Number.isInteger(wordId)) return false;
  const current = rowBy(db, table, ['word_id'], [wordId]);
  if (!current) {
    db.run(`INSERT OR IGNORE INTO ${quoteIdentifier(table)} (word_id) VALUES (?)`, [wordId]);
  }
  const local = rowBy(db, table, ['word_id'], [wordId]) || {};
  const localLast = local.fsrs_last_review ? new Date(local.fsrs_last_review).getTime() : 0;
  const remoteLast = row.fsrs_last_review ? new Date(row.fsrs_last_review).getTime() : 0;
  const useRemoteFsrs = remoteLast > localLast;
  const set = [
    'seen_count = MAX(seen_count, ?)',
    'right_count = MAX(right_count, ?)',
    'fuzzy_count = MAX(fuzzy_count, ?)',
    'forgot_count = MAX(forgot_count, ?)',
    'score = MAX(score, ?)',
    'known_forever = MAX(known_forever, ?)',
    'mastered_on = CASE WHEN COALESCE(mastered_on, "") >= COALESCE(?, "") THEN mastered_on ELSE ? END',
    'last_seen_on = CASE WHEN COALESCE(last_seen_on, "") >= COALESCE(?, "") THEN last_seen_on ELSE ? END'
  ];
  const values = [
    Number(row.seen_count || 0), Number(row.right_count || 0), Number(row.fuzzy_count || 0),
    Number(row.forgot_count || 0), Number(row.score || 0), Number(row.known_forever || 0),
    row.mastered_on || null, row.mastered_on || null, row.last_seen_on || null, row.last_seen_on || null
  ];
  if (useRemoteFsrs) {
    for (const column of ['fsrs_stability', 'fsrs_difficulty', 'fsrs_due', 'fsrs_last_review', 'fsrs_state', 'fsrs_steps', 'fsrs_reps', 'fsrs_lapses']) {
      set.push(`${quoteIdentifier(column)} = ?`);
      values.push(row[column] ?? null);
    }
  }
  values.push(wordId);
  db.run(`UPDATE ${quoteIdentifier(table)} SET ${set.join(', ')} WHERE word_id = ?`, values);
}

function mergeSnapshot(db, bytes, options = {}) {
  const remote = new (db.constructor)(bytes);
  try {
    const hasMeta = tableExists(remote, META_TABLE);
    if (hasMeta) validateSnapshot(remote);
    else if (!options.allowLegacy) throw new Error('云端学习数据缺少同步元数据，已保留本机数据');
    core.ensureStudySchema(db);
    let insertedReviews = 0;
    let mergedMemory = 0;
    let mergedNotes = 0;
    db.run('BEGIN TRANSACTION');
    try {
      for (const table of ['progress', 'reverse_memory', 'kanji_reading_memory']) {
        if (!tableExists(remote, table) || !tableExists(db, table)) continue;
        const columns = columnsOf(remote, table);
        for (const row of sourceRows(remote, table, columns)) {
          mergeMemory(db, table, Object.fromEntries(columns.map((column, index) => [column, row[index]])));
          mergedMemory += 1;
        }
      }
      if (tableExists(remote, 'reviews')) {
        const columns = targetColumns(db, 'reviews', remote);
        for (const row of sourceRows(remote, 'reviews', columns)) {
          const mapped = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
          const exists = core.firstValue(db,
            'SELECT 1 FROM reviews WHERE word_id = ? AND created_at = ? AND direction = ? LIMIT 1',
            [mapped.word_id, mapped.created_at, mapped.direction || 'forward'], 0
          );
          if (!exists) {
            upsertRaw(db, 'reviews', columns, row, ['word_id', 'created_at', 'direction']);
            insertedReviews += 1;
          }
        }
      }
      if (tableExists(remote, 'word_notes')) {
        const columns = targetColumns(db, 'word_notes', remote);
        for (const row of sourceRows(remote, 'word_notes', columns)) {
          const mapped = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
          const local = rowBy(db, 'word_notes', ['word_id'], [mapped.word_id]);
          if (!local || String(mapped.updated_at || '') > String(local.updated_at || '')) {
            upsertRaw(db, 'word_notes', columns, row, ['word_id']);
            mergedNotes += 1;
          }
        }
      }
      for (const table of ['checkins', 'stage1_tasks', 'direction_tasks', 'confusion_mastered', 'achievement_unlocked']) {
        if (!tableExists(remote, table) || !tableExists(db, table)) continue;
        const columns = targetColumns(db, table, remote);
        const keys = table === 'checkins'
          ? ['checked_on']
          : table === 'stage1_tasks'
            ? ['reviewed_on', 'word_id']
            : table === 'direction_tasks'
              ? ['study_day', 'direction', 'word_id']
              : table === 'confusion_mastered'
                ? ['group_key']
                : ['id'];
        for (const row of sourceRows(remote, table, columns)) upsertRaw(db, table, columns, row, keys);
      }
      mergeTombstones(db, remote);
      if (tableExists(remote, 'app_state')) {
        const columns = targetColumns(db, 'app_state', remote);
        for (const row of sourceRows(remote, 'app_state', columns)) {
          const mapped = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
          if (!LOCAL_STATE_KEYS.has(String(mapped.key))) upsertRaw(db, 'app_state', columns, row, ['key']);
        }
      }
      core.setState(db, 'sync_last_at', new Date().toISOString());
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    return { insertedReviews, mergedMemory, mergedNotes };
  } finally {
    remote.close();
  }
}

async function decompressGzip(bytes) {
  const { readCompressedFile, removeFile, writeFile } = require('./wx-promise');
  const path = `${wx.env.USER_DATA_PATH}/shushugo/sync-${Date.now()}-${Math.random().toString(36).slice(2)}.gz`;
  await writeFile(path, bytes);
  try {
    return await readCompressedFile(path, 'gzip');
  } finally {
    await removeFile(path).catch(() => undefined);
  }
}

module.exports = {
  LOCAL_STATE_KEYS,
  SNAPSHOT_TABLES,
  SYNC_PROTOCOL_VERSION,
  SYNC_SNAPSHOT_FORMAT,
  decompressGzip,
  exportSyncSnapshot,
  mergeSnapshot,
  validateSnapshot
};
