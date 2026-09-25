// Taro preview uses a small in-memory copy of the shipped factory seed.
// It never opens or writes the user's Mini Program DB under USER_DATA_PATH.
const fixture = require('./factory-test-fixture.weapp.js');
const content = require('../../scripts/taro-content.cjs');
const { openAndValidate } = require('../../../wechat-miniprogram/src/runtime/sqlite.js');
const { ensureStudySchema } = require('../../../wechat-miniprogram/src/core/study-core.js');

let database = null;
let opening = null;

async function ensureContentLoaded() {
  await content.readyForKanji();
}

async function ensureDatabase() {
  await ensureContentLoaded();
  if (database) return database;
  opening ||= Promise.resolve().then(() => openAndValidate(wx.base64ToArrayBuffer(fixture.base64)))
    .then((candidate) => {
      try {
        ensureStudySchema(candidate);
        database = candidate;
        return database;
      } catch (error) {
        candidate.close();
        throw error;
      }
    }).catch((error) => {
      opening = null;
      throw error;
    });
  return opening;
}

function getDatabase() {
  if (!database) throw new Error('数据库尚未初始化，请先调用 ensureDatabase');
  return database;
}

async function saveDatabase() {
  return { bytes: 0, path: 'memory://taro-factory-fixture' };
}

async function closeDatabase() {
  database?.close();
  database = null;
  opening = null;
}

async function restoreDatabase() {
  await closeDatabase();
  return ensureDatabase();
}

module.exports = {
  ensureContentLoaded,
  ensureDatabase,
  getDatabase,
  getStatus: () => ({ ready: Boolean(database), source: 'factory-memory', paths: databasePaths() }),
  databasePaths,
  atomicWrite: async () => ({ bytes: 0, path: 'memory://taro-factory-fixture' }),
  saveDatabase,
  closeDatabase,
  restoreDatabase
};

function databasePaths() {
  return {
    dbPath: 'memory://taro-factory-fixture',
    tmpPath: 'memory://taro-factory-fixture-tmp',
    prevPath: 'memory://taro-factory-fixture-prev'
  };
}
