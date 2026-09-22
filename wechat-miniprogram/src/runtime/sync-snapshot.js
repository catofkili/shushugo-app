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
const SYNC_PROTOCOL_VERSION = 2;
/*
 * 「收」比「发」宽：v1 是小程序自己的老快照，仍然读得进来。
 *
 * 导出已经抬到 v2：reviews 现在真的带 sync_uid 了（见 study-core 的
 * ensureStudySchema）。⚠️ 抬版本号和补那一列必须一起做 —— 写着 v2 却没有那一列
 * 比拒绝导入更难查。
 */
const SUPPORTED_SYNC_PROTOCOL_VERSIONS = new Set([1, 2]);
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
  // ⚠️ 语法这两张表是小程序**自己会写**的(markGrammar / toggleGrammarFavorite),
  // 所以它们不能靠透传:透传只会把远端旧副本原样送回去,本机新改的一个字都传不出去。
  'grammar_progress',
  'grammar_state',
  'confusion_mastered',
  'achievements',
  'content_favorites',
  'favorite_folders',
  'vocab_test_history',
  'yuzu_ledger',
  'weekly_reports',
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
  'entitlement_cache',
  // 下面这些和网页 sync/tables.ts 的 DEVICE_LOCAL_STATE_KEYS 逐条对齐：
  // 「本机内容迁到哪一版」和「本机磁盘快照停在哪一刻」绝不能跨设备（理由见 CLAUDE.md）。
  // 网页两侧都过滤；这里也两侧都过滤，别指望对端替自己挡。
  'local_snapshot_mark',
  'weekly_report_events',
  'jlpt_seed_version',
  'jlpt_word_metadata_version',
  'jlpt_level_override_version',
  'jlpt_collocation_content_version',
  'dictionary_supplement_version',
  'furigana_version',
  'kana_reading_fix_version',
  'legacy_biru_merge_version',
  // 小程序自己的本机标记
  'content_version',
  'content_protocol_version',
  'study_core_version'
]);
/*
 * grammar_state 里的本地内容标记。⚠️ `dataset_version` 说的是「本机语法内容迁到哪一版」,
 * 而 grammar_points 根本不进快照 —— 把它同步给一台还没跑过迁移的设备,那台的入口判断
 * (版本号相等就早退)会永远跳过迁移,grammar_id 从此和别人错位。和 iOS 端
 * sync/tables.ts 的 isDeviceLocalStateKey 是同一条判据。
 */
const LOCAL_GRAMMAR_STATE_KEYS = new Set(['dataset_version']);

function localKeysFor(table) {
  return table === 'app_state' ? LOCAL_STATE_KEYS
    : table === 'grammar_state' ? LOCAL_GRAMMAR_STATE_KEYS
      : null;
}

const TOMBSTONE_COLUMNS = ['table_name', 'row_key', 'deleted_at', 'origin_device', 'entity', 'natural_key'];

/*
 * 小程序看不懂的表原样存下来，导出时原样送回去。
 *
 * ⚠️ 这不是「以后可能有用」的脚手架，是数据丢失的止血带：Worker 不做按表合并，
 * 它把每次上传当成这个账号新的**完整备份**。小程序只导出自己认识的十几张表，
 * 于是它一推，云端最新那一代就没有 grammar_progress、语法流水、收藏、汉字单元……
 * 攒够三代之后，最后一份完整快照退出保留范围 —— 全新设备再也恢复不出来。
 * 「老设备本地还有一份」不是云备份完整。
 */
const PASSTHROUGH_TABLE = 'sync_passthrough';
const SNAPSHOT_INTERNAL_TABLES = new Set([META_TABLE, PASSTHROUGH_TABLE, 'sync_tombstones']);

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
  const localKeys = localKeysFor(table);
  const excludes = localKeys ? [...localKeys] : [];
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

function ensurePassthroughTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS ${PASSTHROUGH_TABLE} (
    table_name TEXT PRIMARY KEY,
    create_sql TEXT NOT NULL,
    columns_json TEXT NOT NULL,
    rows_json TEXT NOT NULL,
    received_at TEXT NOT NULL
  )`);
}

// sql.js 的 BLOB 读出来是 Uint8Array，JSON 存不下；标记一下原样带回去。
function encodeCell(value) {
  if (value instanceof Uint8Array) {
    let binary = '';
    for (const byte of value) binary += String.fromCharCode(byte);
    return { $b64: typeof btoa === 'function' ? btoa(binary) : Buffer.from(value).toString('base64') };
  }
  return value === undefined ? null : value;
}

function decodeCell(value) {
  if (value && typeof value === 'object' && typeof value.$b64 === 'string') {
    const binary = typeof atob === 'function' ? atob(value.$b64) : Buffer.from(value.$b64, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return value;
}

function knownTables() {
  return new Set([...SNAPSHOT_TABLES, ...SNAPSHOT_INTERNAL_TABLES]);
}

/** 把远端快照里小程序不认识的表整张存下来。每次收到新快照就整个换掉那一份。 */
function capturePassthroughTables(db, remote) {
  ensurePassthroughTable(db);
  const known = knownTables();
  const tables = core.rowsFor(
    remote,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).map((row) => String(row.name)).filter((name) => !known.has(name));
  const now = new Date().toISOString();
  for (const table of tables) {
    const createSql = core.firstValue(
      remote,
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
      ''
    );
    if (!createSql) continue;
    const columns = columnsOf(remote, table);
    const rows = sourceRows(remote, table, columns).map((row) => row.map(encodeCell));
    db.run(
      `INSERT OR REPLACE INTO ${PASSTHROUGH_TABLE} (table_name, create_sql, columns_json, rows_json, received_at) VALUES (?, ?, ?, ?, ?)`,
      [table, String(createSql), JSON.stringify(columns), JSON.stringify(rows), now]
    );
  }
  // 小程序后来认识了的表，本地那份才是真相，别再从透传里覆盖回去。
  for (const table of SNAPSHOT_TABLES) {
    db.run(`DELETE FROM ${PASSTHROUGH_TABLE} WHERE table_name = ?`, [table]);
  }
}

/** 导出时把存下来的那些表原样写回快照。 */
function replayPassthroughTables(db, snapshot) {
  if (!tableExists(db, PASSTHROUGH_TABLE)) return;
  const known = knownTables();
  for (const row of core.rowsFor(db, `SELECT table_name, create_sql, columns_json, rows_json FROM ${PASSTHROUGH_TABLE}`)) {
    const table = String(row.table_name);
    if (known.has(table)) continue;
    let columns = [];
    let rows = [];
    try {
      columns = JSON.parse(String(row.columns_json));
      rows = JSON.parse(String(row.rows_json));
    } catch (error) {
      continue;
    }
    if (!columns.length) continue;
    snapshot.run(String(row.create_sql));
    const insert = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) `
      + `VALUES (${columns.map(() => '?').join(', ')})`;
    snapshot.run('BEGIN');
    try {
      for (const values of rows) snapshot.run(insert, values.map(decodeCell));
      snapshot.run('COMMIT');
    } catch (error) {
      snapshot.run('ROLLBACK');
      throw error;
    }
  }
}

/** 和网页 syncedTablesForCloud 同一条：免费账号本机留周报，但不把正文推上云端。 */
function includeWeeklyReportsByDefault() {
  try { return Boolean(require('./entitlements').cachedEntitlement().active); } catch { return false; }
}

async function exportSyncSnapshot(db, options = {}) {
  const includeWeeklyReports = options.includeWeeklyReports ?? includeWeeklyReportsByDefault();
  // 设备号要先有,ensureStudySchema 才补得上 reviews.sync_uid。
  getDeviceId(db);
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
      if (table === 'weekly_reports' && !includeWeeklyReports) continue;
      if (table === 'sync_tombstones') copyTombstones(db, snapshot);
      else copyTable(db, snapshot, table, originDevice);
    }
    replayPassthroughTables(db, snapshot);
    return new Uint8Array(snapshot.export());
  } finally {
    snapshot.close();
  }
}

function validateSnapshot(db) {
  const format = core.firstValue(db, `SELECT format FROM ${META_TABLE} LIMIT 1`, [], null);
  const version = core.firstValue(db, `SELECT protocol_version FROM ${META_TABLE} LIMIT 1`, [], null);
  if (format !== SYNC_SNAPSHOT_FORMAT || !SUPPORTED_SYNC_PROTOCOL_VERSIONS.has(Number(version))) {
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
              : entity === 'achievements' ? ['id']
                : entity === 'content_favorites' ? ['item_type', 'item_id']
                  : entity === 'favorite_folders' ? ['name']
                    : entity === 'vocab_test_history' ? ['run_id']
                      : entity === 'yuzu_ledger' ? ['kind', 'key']
                        : entity === 'weekly_reports' ? ['week_start']
                : ['word_id'];
}

function applyTombstone(db, tombstone) {
  const table = tombstone.entity;
  if (!tableExists(db, table)) return false;
  let keys = tombstoneKeyColumns(table);
  const values = tombstone.naturalKey.split('\u001f');
  // 作答流水的跨端身份是 sync_uid：网页 / App 的墓碑就是一段 uid（没有分隔符）。
  // 老的三列自然键写法仍然认，两种都能删。
  if (table === 'reviews' && values.length === 1) keys = ['sync_uid'];
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

/* 语法进度按 grammar_id 合并。和 mergeMemory 一样:计数只增不减,FSRS 全字段
   跟着更新的那一侧走(半份 FSRS 状态是没有意义的)。 */
function mergeGrammarProgress(db, row) {
  const grammarId = Number(row.grammar_id);
  if (!Number.isInteger(grammarId)) return;
  const existed = rowBy(db, 'grammar_progress', ['grammar_id'], [grammarId]);
  db.run('INSERT OR IGNORE INTO grammar_progress (grammar_id) VALUES (?)', [grammarId]);
  const local = rowBy(db, 'grammar_progress', ['grammar_id'], [grammarId]) || {};
  const localLast = local.fsrs_last_review ? new Date(local.fsrs_last_review).getTime() : 0;
  const remoteLast = row.fsrs_last_review ? new Date(row.fsrs_last_review).getTime() : 0;
  const set = [
    'seen_count = MAX(seen_count, ?)',
    'right_count = MAX(right_count, ?)',
    'fuzzy_count = MAX(fuzzy_count, ?)',
    'forgot_count = MAX(forgot_count, ?)',
    'known_forever = MAX(known_forever, ?)',
    'last_seen_on = CASE WHEN COALESCE(last_seen_on, "") >= COALESCE(?, "") THEN last_seen_on ELSE ? END'
  ];
  const values = [
    Number(row.seen_count || 0), Number(row.right_count || 0), Number(row.fuzzy_count || 0),
    Number(row.forgot_count || 0), Number(row.known_forever || 0),
    row.last_seen_on || null, row.last_seen_on || null
  ];
  // 这些值会下降或清空，不能取 MAX；跟随最近学习的一侧，旧版无日期时比较次数。
  const localActivity = Math.max(localLast || 0, Date.parse(local.last_seen_on || '') || 0);
  const remoteActivity = Math.max(remoteLast || 0, Date.parse(row.last_seen_on || '') || 0);
  if (!existed || remoteActivity > localActivity
      || (remoteActivity === localActivity && Number(row.seen_count || 0) > Number(local.seen_count || 0))) {
    for (const column of ['score', 'low_history', 'mistake_streak', 'last_decay_amount', 'mastered_on']) {
      // 老版本缺列不能把现有值清掉；显式 null 则仍然传递。
      if (Object.prototype.hasOwnProperty.call(row, column)) {
        set.push(`${quoteIdentifier(column)} = ?`);
        values.push(row[column]);
      }
    }
  }
  // 本机这行从来没排过期(localLast 为 0)而对端排过 → 直接收下。只比
  // `remoteLast > localLast` 的话,对端那份 fsrs_due 会被静默丢掉。
  if (remoteLast > localLast || (localLast === 0 && row.fsrs_due)) {
    for (const column of ['fsrs_stability', 'fsrs_difficulty', 'fsrs_due', 'fsrs_last_review', 'fsrs_state', 'fsrs_steps', 'fsrs_reps', 'fsrs_lapses']) {
      set.push(`${quoteIdentifier(column)} = ?`);
      values.push(row[column] ?? null);
    }
  }
  values.push(grammarId);
  db.run(`UPDATE grammar_progress SET ${set.join(', ')} WHERE grammar_id = ?`, values);
}

function mergeSnapshot(db, bytes, options = {}) {
  const remote = new (db.constructor)(bytes);
  try {
    const hasMeta = tableExists(remote, META_TABLE);
    if (hasMeta) validateSnapshot(remote);
    else if (!options.allowLegacy) throw new Error('云端学习数据缺少同步元数据，已保留本机数据');
    getDeviceId(db);
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
          // ⚠️ 有 sync_uid 就只认 sync_uid。created_at 只到秒，前端同一秒答两次
          // 会产生两条自然键完全相同、uid 不同的作答；按自然键去重只会进来一条。
          // 本机撤销过（或对端撤销后同步过来）的作答有墓碑，一份旧快照不能把它再送回来。
          const buried = mapped.sync_uid
            && core.firstValue(db, "SELECT 1 FROM sync_tombstones WHERE entity = 'reviews' AND natural_key = ? LIMIT 1", [mapped.sync_uid], 0);
          if (buried) continue;
          const exists = mapped.sync_uid
            ? core.firstValue(db, 'SELECT 1 FROM reviews WHERE sync_uid = ? LIMIT 1', [mapped.sync_uid], 0)
            : core.firstValue(db,
              'SELECT 1 FROM reviews WHERE word_id = ? AND created_at = ? AND direction = ? AND sync_uid IS NULL LIMIT 1',
              [mapped.word_id, mapped.created_at, mapped.direction || 'forward'], 0
            );
          if (!exists) {
            upsertRaw(db, 'reviews', columns, row, mapped.sync_uid ? ['sync_uid'] : ['word_id', 'created_at', 'direction']);
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
      for (const table of ['checkins', 'stage1_tasks', 'direction_tasks', 'confusion_mastered', 'achievements']) {
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
      // 这些记录都是稳定自然键：收藏/文件夹允许较新的同键行覆盖；测试历史与
      // 柚子账本是追加集合；周报按生成时间取新。删除由 sync_tombstones 处理。
      for (const [table, keys] of [
        ['content_favorites', ['item_type', 'item_id']],
        ['favorite_folders', ['name']],
        ['vocab_test_history', ['run_id']],
        ['yuzu_ledger', ['kind', 'key']],
        ['weekly_reports', ['week_start']]
      ]) {
        if (!tableExists(remote, table) || !tableExists(db, table)) continue;
        const remoteColumns = columnsOf(remote, table);
        const columns = targetColumns(db, table, remote);
        for (const remoteRow of sourceRows(remote, table, remoteColumns)) {
          const mapped = Object.fromEntries(remoteColumns.map((column, index) => [column, remoteRow[index]]));
          const row = columns.map((column) => mapped[column]);
          const local = rowBy(db, table, keys, keys.map((key) => mapped[key]));
          const remoteTime = String(mapped.sync_updated_at || mapped.generated_at || mapped.created_at || mapped.finished_at || '1970-01-01T00:00:00.000Z');
          const naturalKey = keys.map((key) => String(mapped[key] ?? '')).join('\u001f');
          const localDeletion = core.firstValue(db,
            'SELECT deleted_at FROM sync_tombstones WHERE entity = ? AND natural_key = ? LIMIT 1',
            [table, naturalKey], '');
          if (localDeletion && String(localDeletion) >= remoteTime) continue;
          if (table === 'weekly_reports' && local) {
            const localTime = String(local.sync_updated_at || local.generated_at || '');
            if (remoteTime <= localTime) continue;
          }
          if ((table === 'content_favorites' || table === 'favorite_folders') && local
              && remoteTime <= String(local.sync_updated_at || local.created_at || '')) continue;
          upsertRaw(db, table, columns, row, keys);
        }
      }
      // 语法进度:和 progress 同一套口径(计数取大、FSRS 看谁的 last_review 新),
      // 只是键换成 grammar_id。
      if (tableExists(remote, 'grammar_progress') && tableExists(db, 'grammar_progress')) {
        const columns = targetColumns(db, 'grammar_progress', remote);
        for (const row of sourceRows(remote, 'grammar_progress', columns)) {
          const mapped = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
          mergeGrammarProgress(db, mapped);
        }
      }
      if (tableExists(remote, 'grammar_state') && tableExists(db, 'grammar_state')) {
        const columns = targetColumns(db, 'grammar_state', remote);
        for (const row of sourceRows(remote, 'grammar_state', columns)) {
          const mapped = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
          if (!LOCAL_GRAMMAR_STATE_KEYS.has(String(mapped.key))) upsertRaw(db, 'grammar_state', columns, row, ['key']);
        }
      }
      mergeTombstones(db, remote);
      capturePassthroughTables(db, remote);
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
  // fflate 在 JS 里解，不依赖基础库的 readCompressedFile，也不用先落一个临时文件。
  return require('../vendor/fflate.umd.js').gunzipSync(bytes);
}

module.exports = {
  LOCAL_STATE_KEYS,
  PASSTHROUGH_TABLE,
  SNAPSHOT_TABLES,
  SUPPORTED_SYNC_PROTOCOL_VERSIONS,
  SYNC_PROTOCOL_VERSION,
  SYNC_SNAPSHOT_FORMAT,
  decompressGzip,
  exportSyncSnapshot,
  mergeSnapshot,
  validateSnapshot
};
