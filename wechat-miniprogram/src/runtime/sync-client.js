/* Cloudflare 同步适配器。
 *
 * 服务端保存的是 master-nihongo-user-sqlite-v1 二进制快照，而不是早期
 * 试验用的 JSON envelope。每次同步先拉取并按行合并，再带 generation 乐观
 * 并发版本上传；因此首次把已有本地学习数据绑定到账号时也不会覆盖云端。
 */
const config = require('../config');
const { requestBinary, requestJson } = require('./wx-promise');
const { getDatabase, saveDatabase } = require('./database-store');
const { authHeaders } = require('./auth');
const core = require('../core/study-core');
const { getDeviceId } = require('../core/sync-protocol');
const {
  SYNC_PROTOCOL_VERSION,
  SYNC_SNAPSHOT_FORMAT,
  decompressGzip,
  exportSyncSnapshot,
  mergeSnapshot
} = require('./sync-snapshot');

function requireSyncUrl() {
  if (!config.syncUrl) throw new Error('没有配置 syncUrl；当前保持纯离线模式');
  return config.syncUrl.replace(/\/$/g, '');
}

function syncApiUrl() {
  const base = requireSyncUrl();
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

function state(db, key, fallback = '') {
  return core.getState(db, key, fallback);
}

function header(headers, name) {
  const target = String(name).toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => String(key).toLowerCase() === target);
  return entry ? entry[1] : undefined;
}

function toGeneration(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function operationId() {
  return `wx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function pushSnapshot(bytes, options = {}) {
  const db = getDatabase();
  const headers = {
    ...authHeaders(),
    'content-type': 'application/octet-stream',
    'x-sync-format': SYNC_SNAPSHOT_FORMAT,
    'x-sync-protocol-version': String(SYNC_PROTOCOL_VERSION),
    'x-sync-compression': 'none',
    'x-sync-operation-id': operationId(),
    'x-sync-device-id': getDeviceId(db)
  };
  if (typeof options.baseGeneration === 'number') headers['x-sync-base-generation'] = String(options.baseGeneration);
  if (options.baseModified) headers['x-sync-base-modified'] = String(options.baseModified);
  return requestJson(`${syncApiUrl()}/sync/push`, {
    method: 'POST',
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    header: headers
  });
}

async function pullSnapshot() {
  const response = await requestBinary(`${syncApiUrl()}/sync/pull`, {
    method: 'GET',
    header: { ...authHeaders(), accept: 'application/octet-stream' },
    timeout: 60_000
  });
  const compression = header(response.header, 'x-sync-compression') || 'none';
  if (compression !== 'none' && compression !== 'gzip') throw new Error(`不支持云端压缩格式：${compression}`);
  const bytes = compression === 'gzip' ? await decompressGzip(response.bytes) : response.bytes;
  const format = header(response.header, 'x-sync-format') || 'legacy-full-sqlite';
  const lastModified = header(response.header, 'x-sync-last-modified');
  if (!lastModified) throw new Error('云端学习数据缺少版本时间，已保留本机数据');
  return {
    bytes,
    format,
    compression,
    lastModified: String(lastModified),
    generation: toGeneration(header(response.header, 'x-sync-generation'))
  };
}

async function syncStatus() {
  return requestJson(`${syncApiUrl()}/sync/status`, {
    method: 'GET',
    header: authHeaders()
  });
}

function saveCursor(db, generation, modified) {
  if (typeof generation === 'number') core.setState(db, 'sync_generation', generation);
  if (modified) core.setState(db, 'sync_last_modified', modified);
  core.setState(db, 'sync_last_pushed_at', new Date().toISOString());
}

async function mergeRemote(db, remote) {
  // legacy-full-sqlite 只用于兼容旧服务端快照；mergeSnapshot 会只处理
  // 用户表，不会把云端词典覆盖本地内容。
  const result = mergeSnapshot(db, remote.bytes, { allowLegacy: remote.format === 'legacy-full-sqlite' });
  saveCursor(db, remote.generation, remote.lastModified);
  return result;
}

async function syncNow() {
  const db = getDatabase();
  core.ensureStudySchema(db);
  let pulled = null;
  let merged = { insertedReviews: 0, mergedMemory: 0, mergedNotes: 0 };
  let remoteState = null;
  try {
    remoteState = await syncStatus();
  } catch (error) {
    // 旧服务端没有 /status 时不阻塞手动同步；push 的 generation 冲突仍会
    // 被显式抛出，用户可以稍后更新服务端/小程序后再合并。
    if (error?.statusCode !== 404) throw error;
  }
  if (remoteState?.available) {
    pulled = await pullSnapshot();
    merged = await mergeRemote(db, pulled);
  }

  const outgoing = await exportSyncSnapshot(db);
  const pushed = await pushSnapshot(outgoing, {
    baseGeneration: pulled?.generation ?? toGeneration(remoteState?.generation) ?? toGeneration(state(db, 'sync_generation', '')),
    baseModified: pulled?.lastModified ?? remoteState?.last_modified ?? state(db, 'sync_last_modified', '')
  });
  saveCursor(db, toGeneration(pushed?.generation), pushed?.timestamp);
  await saveDatabase();
  return {
    pushed: true,
    pulled: Boolean(pulled),
    merged,
    generation: toGeneration(pushed?.generation),
    lastModified: pushed?.timestamp || null
  };
}

module.exports = { pullSnapshot, pushSnapshot, syncNow, syncStatus };
