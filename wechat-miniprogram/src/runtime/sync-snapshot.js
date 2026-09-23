/*
 * 云同步的导出与合并 = 网页那一份（sync/snapshot.ts + sync/merge.ts，见 src/shared/web.js）。
 *
 * ⚠️ 以前这里是小程序自己写的 678 行合并器：自己的表清单、自己的 lww、自己的墓碑格式
 * （entity/natural_key）、自己的「看不懂的表原样透传」。三端写的是同一份快照，
 * 合并规则各写一套的结果就是「谁最后推谁说了算」这种说不清的行为，
 * 而且小程序不认识的表（汉字单元、连线卡、周报…）永远只能透传，本机改的传不出去。
 * 现在两端跑的是同一段代码，行为按定义一致。
 *
 * 只保留三件小程序特有的事：
 *  1. db-first 的调用惯例（withDb）；
 *  2. 老快照的墓碑列名翻译（老小程序推上去的那几代快照还在云端）；
 *  3. gzip 用 fflate（小程序没有 DecompressionStream）。
 */
const core = require('../core/study-core');
const { getDatabase } = require('./database-store');

const web = core.web;

/*
 * ⚠️ 小程序把登录态和权益缓存放在 app_state（网页放 localStorage / secure storage），
 * 所以网页那份 DEVICE_LOCAL_STATE_KEYS 里没有它们 —— 不补进去的话 access token
 * 会跟着快照上云、再同步到别的设备。补进同一个 Set：网页的导出和合并两侧都读它。
 */
for (const key of ['auth_access_token', 'auth_user_id', 'entitlement_cache', 'content_version', 'content_protocol_version', 'wechat_session', 'wechat_openid']) {
  web.syncTables.DEVICE_LOCAL_STATE_KEYS.add(key);
}

const SYNC_SNAPSHOT_FORMAT = web.syncSnapshot.SYNC_SNAPSHOT_FORMAT;
const SYNC_PROTOCOL_VERSION = web.syncSnapshot.SYNC_PROTOCOL_VERSION;
const SNAPSHOT_TABLES = web.syncTables.SYNCED_TABLES.map((entry) => entry.table);

const tableExists = (db, table) => Boolean(db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [table])[0]?.values?.length);
const columnsOf = (db, table) => new Set(db.exec(`PRAGMA table_info(${table})`)[0]?.values.map((row) => String(row[1])) || []);

/**
 * 老小程序（0.1.x）推上去的快照把墓碑写成 entity/natural_key，网页按 table_name/row_key 读。
 * 不翻译的话那几代快照里的删除会被静默忽略 —— 用户在小程序上删掉的收藏会复活。
 */
function normalizeLegacyTombstones(db) {
  if (!tableExists(db, 'sync_tombstones')) return;
  const columns = columnsOf(db, 'sync_tombstones');
  if (columns.has('table_name') || !columns.has('entity')) return;
  db.run('ALTER TABLE sync_tombstones ADD COLUMN table_name TEXT');
  db.run('ALTER TABLE sync_tombstones ADD COLUMN row_key TEXT');
  db.run('UPDATE sync_tombstones SET table_name = entity, row_key = natural_key');
}

async function exportSyncSnapshot(db = getDatabase()) {
  core.ensureStudySchema(db);
  return core.withDb(db, () => web.syncSnapshot.exportSyncSnapshot());
}

/**
 * 按行合并云端快照。返回值沿用小程序原来的形状（页面显示「合并了多少」）。
 * 合并本身、冲突判定、墓碑、设备号比较全在网页的 mergeDatabaseBytes 里。
 */
async function mergeSnapshot(db, bytes) {
  core.ensureStudySchema(db);
  // 合并末尾要按流水重建汉字单元 / 单独汉字 / 连线卡的记忆检查点（网页的 mergeDatabaseBytes
  // 里那三段 replay），那几段要读分包里的内容索引 —— 先把它们拉下来，否则合并中途抛错。
  await require('../shared/content').readyForKanji();
  const remote = new (db.constructor)(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  let normalized = bytes;
  try {
    normalizeLegacyTombstones(remote);
    normalized = new Uint8Array(remote.export());
  } finally {
    remote.close();
  }
  const before = counters(db);
  await core.withDb(db, () => web.syncMerge.mergeDatabaseBytes(normalized));
  core.withDb(db, () => web.levelPlan.hydrateLevelPlanPreferences());
  const after = counters(db);
  return {
    insertedReviews: Math.max(after.reviews - before.reviews, 0),
    mergedMemory: after.progress,
    mergedNotes: after.notes
  };
}

function counters(db) {
  return core.withDb(db, () => ({
    reviews: web.dbUtils.firstValue('SELECT COUNT(*) FROM reviews', [], 0),
    progress: web.dbUtils.firstValue('SELECT COUNT(*) FROM progress WHERE seen_count > 0', [], 0),
    notes: web.dbUtils.firstValue("SELECT COUNT(*) FROM word_notes WHERE TRIM(note) <> ''", [], 0)
  }));
}

/** 小程序没有 DecompressionStream，gzip 在 JS 里解（fflate）。 */
async function decompressGzip(bytes) {
  return require('../vendor/fflate.umd.js').gunzipSync(bytes);
}

module.exports = {
  SNAPSHOT_TABLES,
  SYNC_SNAPSHOT_FORMAT,
  SYNC_PROTOCOL_VERSION,
  exportSyncSnapshot,
  mergeSnapshot,
  decompressGzip
};
