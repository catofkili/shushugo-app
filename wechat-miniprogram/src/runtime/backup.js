const { getDatabase, saveDatabase } = require('./database-store');
const { openAndValidate } = require('./sqlite');
const { makeDirectory, readFile, renameFile, writeFile } = require('./wx-promise');
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

/*
 * 导入整库备份 = 按行合并，走网页那一份 mergeDatabaseBytes（和云同步同一条路）。
 *
 * ⚠️ 以前这里是小程序自己的 JSON envelope 合并器（sync-protocol 的 buildEnvelope /
 * applyEnvelope）：只认 reviews / progress / reverse_memory 那几张表，收藏、成就、柚子、
 * 周报、汉字卡、连线卡全都不合并 —— 导入备份等于把它们丢掉。
 *
 * ⚠️ 导入之后必须换设备号（resetDeviceId）：作答流水的跨端身份是「设备号:本机行号」，
 * 不换的话两台设备从同一份备份出发、各自答一道**不同**的题会生成一模一样的 uid，
 * 云端按 uid 合并时把两次不同的作答当成同一件事，后到的那条直接丢掉。
 */
async function importBackup(filePath) {
  const local = getDatabase();
  core.ensureStudySchema(local);
  const bytes = await readFile(filePath);
  const source = await openAndValidate(bytes);
  source.close();
  const before = core.firstValue(local, 'SELECT COUNT(*) FROM reviews', [], 0);
  const { mergeSnapshot } = require('./sync-snapshot');
  const result = await mergeSnapshot(local, bytes);
  core.withDb(local, () => core.web.syncSchema.resetDeviceId());
  await saveDatabase();
  return { ...result, insertedReviews: core.firstValue(local, 'SELECT COUNT(*) FROM reviews', [], 0) - before };
}

module.exports = { exportBackup, importBackup };
