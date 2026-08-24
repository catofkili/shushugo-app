const { getDatabase, saveDatabase } = require('./database-store');
const { openAndValidate } = require('./sqlite');
const { makeDirectory, readFile, renameFile, writeFile } = require('./wx-promise');
const { applyEnvelope, buildEnvelope } = require('../core/sync-protocol');
const core = require('../core/study-core');

const root = wx.env.USER_DATA_PATH;
const backupDirectory = `${root}/shushugo/backups`;

async function exportBackup() {
  const db = getDatabase();
  core.ensureStudySchema(db);
  // 备份可以分享给自己或迁移设备，但绝不能把服务端 access token 一起带出去。
  const copy = await openAndValidate(db.export());
  copy.run("DELETE FROM app_state WHERE key IN ('auth_access_token', 'auth_user_id', 'entitlement_cache')");
  const bytes = copy.export();
  copy.close();
  await makeDirectory(backupDirectory);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${backupDirectory}/nihongo-${stamp}.db`;
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, bytes);
  await renameFile(tempPath, path);
  return { path, bytes: bytes.byteLength };
}

async function importBackup(filePath) {
  const local = getDatabase();
  const bytes = await readFile(filePath);
  const source = await openAndValidate(bytes);
  try {
    const envelope = buildEnvelope(source);
    const result = applyEnvelope(local, envelope);
    await saveDatabase();
    return result;
  } finally {
    source.close();
  }
}

module.exports = { exportBackup, importBackup };
