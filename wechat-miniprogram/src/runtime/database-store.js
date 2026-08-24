const config = require('../config');
const {
  downloadFile,
  fileExists,
  makeDirectory,
  readFile,
  removeFile,
  renameFile,
  writeFile
} = require('./wx-promise');
const { openAndValidate } = require('./sqlite');
const { ensureStudySchema } = require('../core/study-core');

const root = wx.env.USER_DATA_PATH;
const DB_PATH = `${root}/shushugo/nihongo.db`;
const TMP_PATH = `${root}/shushugo/nihongo.db.tmp`;
const PREV_PATH = `${root}/shushugo/nihongo.db.prev`;
const DB_DIRECTORY = `${root}/shushugo`;

let database = null;
let databaseSource = null;

function databasePaths() {
  return { dbPath: DB_PATH, tmpPath: TMP_PATH, prevPath: PREV_PATH };
}

async function loadExistingDatabase() {
  for (const [path, label] of [[DB_PATH, 'main'], [TMP_PATH, 'tmp'], [PREV_PATH, 'prev']]) {
    if (!(await fileExists(path))) continue;
    try {
      const bytes = await readFile(path);
      const candidate = await openAndValidate(bytes);
      ensureStudySchema(candidate);
      database = candidate;
      databaseSource = label;
      return { database: candidate, source: label };
    } catch (error) {
      console.warn(`[database] 忽略损坏的 ${label} 文件`, error);
    }
  }
  return null;
}

async function copyDownloadedFile(tempPath) {
  const bytes = await readFile(tempPath);
  const candidate = await openAndValidate(bytes);
  ensureStudySchema(candidate);
  candidate.close();
  await atomicWrite(bytes);
  return bytes;
}

async function downloadSeedDatabase() {
  if (!config.seedDatabaseUrl) {
    throw new Error('没有配置 seedDatabaseUrl；请在 src/config.js 填写备案 HTTPS 词库地址');
  }
  const tempPath = await downloadFile(config.seedDatabaseUrl);
  try {
    return await copyDownloadedFile(tempPath);
  } finally {
    await removeFile(tempPath).catch(() => undefined);
  }
}

async function readSeedFromCodePackage() {
  if (!config.seedDatabasePath) return null;
  const bytes = await readFile(config.seedDatabasePath);
  await openAndValidate(bytes).then((candidate) => {
    ensureStudySchema(candidate);
    candidate.close();
  });
  return bytes;
}

async function atomicWrite(bytes) {
  if (!bytes || bytes.byteLength < 1024) throw new Error('拒绝写入过小的数据库文件');
  // 先完整写入 tmp；随后轮转 main → prev，最后 tmp → main。
  // 任一步中断都保留至少一份完整数据库，冷启动会按 main/tmp/prev 尝试恢复。
  await makeDirectory(DB_DIRECTORY);
  await writeFile(TMP_PATH, bytes);
  if (await fileExists(PREV_PATH)) await removeFile(PREV_PATH);
  if (await fileExists(DB_PATH)) await renameFile(DB_PATH, PREV_PATH);
  try {
    await renameFile(TMP_PATH, DB_PATH);
  } catch (error) {
    if (!(await fileExists(DB_PATH)) && await fileExists(PREV_PATH)) {
      await renameFile(PREV_PATH, DB_PATH).catch(() => undefined);
    }
    throw error;
  }
}

async function ensureDatabase() {
  if (database) return database;

  const existing = await loadExistingDatabase();
  if (existing) return existing.database;

  const seed = await readSeedFromCodePackage() ?? await downloadSeedDatabase();
  database = await openAndValidate(seed);
  ensureStudySchema(database);
  databaseSource = 'seed';
  return database;
}

async function saveDatabase() {
  if (!database) throw new Error('数据库尚未初始化');
  const bytes = database.export();
  await atomicWrite(bytes);
  databaseSource = 'main';
  return { bytes: bytes.length, path: DB_PATH };
}

async function restoreDatabase() {
  database = null;
  databaseSource = null;
  const existing = await loadExistingDatabase();
  if (!existing) throw new Error('用户目录没有可恢复的数据库');
  return existing.database;
}

async function closeDatabase() {
  if (database) database.close();
  database = null;
  databaseSource = null;
}

function getDatabase() {
  if (!database) throw new Error('数据库尚未初始化，请先点击初始化本地库');
  return database;
}

function getStatus() {
  return {
    ready: Boolean(database),
    source: databaseSource,
    paths: databasePaths()
  };
}

module.exports = {
  atomicWrite,
  databasePaths,
  ensureDatabase,
  getDatabase,
  closeDatabase,
  getStatus,
  restoreDatabase,
  saveDatabase
};
