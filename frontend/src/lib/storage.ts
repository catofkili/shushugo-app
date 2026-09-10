import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { exportDatabase, getDatabase, importDatabase } from './database';
import { ensureSyncSchema, resetDeviceId } from './sync/schema';
import {
  applyDelta,
  collectDelta,
  currentMark,
  deltaRowCount,
  readSnapshotMark,
  stampSnapshotMark,
  type LocalDelta
} from './local-delta';

// 供当前页面把“数据库写盘失败”显示出来；旧版 localStorage 配额异常曾被静默吞掉。
export const PERSISTENCE_ERROR_EVENT = 'persistence-error';
/** 上一次失败之后又写成功了。只有真出过错才派 —— 平时每 2 秒一次的成功不用广播。 */
export const PERSISTENCE_OK_EVENT = 'persistence-ok';

let persistenceFailed = false;

const notifyPersistenceError = () => {
  persistenceFailed = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PERSISTENCE_ERROR_EVENT));
};

const notifyPersistenceOk = () => {
  if (!persistenceFailed) return;
  persistenceFailed = false;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PERSISTENCE_OK_EVENT));
};

/**
 * 「有存档、但打不开」。
 *
 * ⚠️ 这和「没有存档」必须分开抛给调用方。以前两种都返回 false,而 main.tsx 拿到
 * false 就去加载出厂库 —— 用户看到的是一份崭新的空库,下一次 saveDatabase 又用
 * 同一个 key/文件名写回去,那份可能只是暂时读不出来的存档就被出厂库盖掉了。
 * 现在这条路必须停下来问人:重试 / 导出这份存档 / 明确同意重建。
 */
export class LocalArchiveUnreadableError extends Error {
  constructor(readonly archive: Uint8Array | null, readonly reason: unknown) {
    super('本机学习存档读取失败');
    this.name = 'LocalArchiveUnreadableError';
  }
}

// 旧方案:数据库 base64 后分块存 Capacitor Preferences(iOS 上是 UserDefaults)。
// UserDefaults 不适合放大数据(整份 plist 常驻内存、每次写整体重写),
// 现在原生平台改为 Filesystem 单文件 + 三代轮转,这些键只用于一次性迁移。
const DB_KEY = 'nihongo_db';
const DB_MANIFEST_KEY = 'nihongo_db_manifest';
const DB_CHUNK_KEY_PREFIX = 'nihongo_db_chunk_';

// 原生平台的数据库文件。写入顺序 tmp → (main→prev) → (tmp→main),
// 任何一步中断都能从 main / tmp / prev 之一恢复出完整数据库。
const DB_DIRECTORY = Directory.Library;
const DB_FILE_MAIN = 'masternihongo/nihongo.db';
const DB_FILE_TMP = 'masternihongo/nihongo.db.tmp';
const DB_FILE_PREV = 'masternihongo/nihongo.db.prev';
// 增量。**永远只有一份**:每条增量都是「快照之后改过的所有行」,后一条整个盖住前一条,
// 所以不需要序号、不需要排序、也不会出现「回放了一半」的中间态。
const DB_FILE_DELTA = 'masternihongo/nihongo.delta.json';
const DB_FILE_DELTA_TMP = 'masternihongo/nihongo.delta.json.tmp';
// 回放失败的那一份,另存备查(见 stashFailedDelta),启动时不读它。
const DB_FILE_DELTA_FAILED = 'masternihongo/nihongo.delta.failed.json';

// 浏览器端不能把整份 SQLite 数据库存进 localStorage：它有严格的容量限制，
// 大一点的个人学习库会在“恢复备份”时写入失败。IndexedDB 专门用于二进制数据。
const BROWSER_DB_NAME = 'master-nihongo-storage';
const BROWSER_DB_STORE = 'databases';
const BROWSER_DB_KEY = 'study-database';
const BROWSER_RECOVERY_KEY_PREFIX = 'recovery-';
const BROWSER_DELTA_KEY = 'study-database-delta';

const isNativeFileStorage = () => Capacitor.isNativePlatform();

const openBrowserDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(BROWSER_DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(BROWSER_DB_STORE)) {
      request.result.createObjectStore(BROWSER_DB_STORE);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Unable to open browser database storage'));
});

const saveBrowserDatabase = async (data: Uint8Array): Promise<void> => {
  const browserDb = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = browserDb.transaction(BROWSER_DB_STORE, 'readwrite');
    transaction.objectStore(BROWSER_DB_STORE).put(data.slice().buffer, BROWSER_DB_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save browser database'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser database save aborted'));
  });
  browserDb.close();
};

/**
 * 数据迁移前的整库恢复点。
 *
 * 浏览器端和正式数据库放在同一个 IndexedDB store、不同 key 下；正常启动只读取
 * study-database，不会把恢复点误当成当前数据。原生端保存为 Library 下的独立文件。
 * 同名迁移只需要保留最近一次执行前的状态，因此 key/path 固定，不无限堆积。
 */
export async function saveRecoverySnapshot(label: string): Promise<string> {
  const data = exportDatabase();
  if (!data) throw new Error('Database is not ready for recovery snapshot');
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'migration';

  if (isNativeFileStorage()) {
    const path = `masternihongo/recovery-${safeLabel}.db`;
    await Filesystem.writeFile({
      path,
      data: bytesToBase64(data),
      directory: DB_DIRECTORY,
      recursive: true
    });
    return path;
  }

  const key = `${BROWSER_RECOVERY_KEY_PREFIX}${safeLabel}`;
  const browserDb = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = browserDb.transaction(BROWSER_DB_STORE, 'readwrite');
    transaction.objectStore(BROWSER_DB_STORE).put(data.slice().buffer, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save recovery snapshot'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Recovery snapshot save aborted'));
  });
  browserDb.close();
  return `${BROWSER_DB_NAME}/${BROWSER_DB_STORE}/${key}`;
}

const loadBrowserDatabase = async (): Promise<Uint8Array | null> => {
  const browserDb = await openBrowserDatabase();
  const stored = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const request = browserDb.transaction(BROWSER_DB_STORE, 'readonly').objectStore(BROWSER_DB_STORE).get(BROWSER_DB_KEY);
    request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error('Unable to read browser database'));
  });
  browserDb.close();
  return stored ? new Uint8Array(stored) : null;
};

/**
 * 存档读出来了但打不开(sql.js 打不开 / 缺表)时,先把原始字节挪到另一个 key。
 *
 * 不这么做的话这条路是静默毁数据的:loadDatabase 只能回答 true/false,
 * false 会让 main.tsx 去加载出厂词库,而下一次 saveDatabase 用的还是
 * BROWSER_DB_KEY —— 那份可能只是暂时读不出来的存档就被出厂库盖掉了。
 * 原生端有 main/tmp/prev 三代可退,浏览器端只有这一个 key。
 *
 * 第一份坏存档才是有价值的那份,所以已经存过就不再覆盖。
 *
 * 存完之后 loadDatabase 抛 LocalArchiveUnreadableError,由 main.tsx 的启动画面
 * 摆出「重试 / 导出这份存档 / 重建」三条路 —— 这条路发生在 root.render 之前,
 * 派 PERSISTENCE_ERROR_EVENT 没人听得见。
 */
const stashUnreadableBrowserDatabase = async (data: Uint8Array): Promise<void> => {
  const key = `${BROWSER_RECOVERY_KEY_PREFIX}unreadable-archive`;
  const browserDb = await openBrowserDatabase();
  try {
    const existing = await new Promise<unknown>((resolve, reject) => {
      const request = browserDb.transaction(BROWSER_DB_STORE, 'readonly').objectStore(BROWSER_DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to read stash'));
    });
    if (existing) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = browserDb.transaction(BROWSER_DB_STORE, 'readwrite');
      transaction.objectStore(BROWSER_DB_STORE).put(data.slice().buffer, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to stash unreadable database'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Stash aborted'));
    });
    console.warn(`[storage] 本机存档打不开，已原样保留在 ${BROWSER_DB_NAME}/${BROWSER_DB_STORE}/${key}`);
  } finally {
    browserDb.close();
  }
};

const clearBrowserDatabase = async (): Promise<void> => {
  const browserDb = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = browserDb.transaction(BROWSER_DB_STORE, 'readwrite');
    transaction.objectStore(BROWSER_DB_STORE).delete(BROWSER_DB_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to clear browser database'));
  });
  browserDb.close();
};

/**
 * 增量的读/写/删。两个平台各一份实现,语义完全一样:**要么是上一份完整的增量,
 * 要么是这一份完整的增量,不会读到半份**(浏览器靠 IndexedDB 事务,原生靠 rename)。
 */
const saveDeltaRecord = async (json: string): Promise<void> => {
  if (isNativeFileStorage()) {
    await Filesystem.writeFile({
      path: DB_FILE_DELTA_TMP, data: json, directory: DB_DIRECTORY, encoding: Encoding.UTF8, recursive: true
    });
    await deleteFileIfExists(DB_FILE_DELTA);
    await Filesystem.rename({
      from: DB_FILE_DELTA_TMP, to: DB_FILE_DELTA, directory: DB_DIRECTORY, toDirectory: DB_DIRECTORY
    });
    return;
  }
  const browserDb = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = browserDb.transaction(BROWSER_DB_STORE, 'readwrite');
    transaction.objectStore(BROWSER_DB_STORE).put(json, BROWSER_DELTA_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save delta'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Delta save aborted'));
  });
  browserDb.close();
};

const readDeltaRecord = async (): Promise<string | null> => {
  if (isNativeFileStorage()) {
    // ⚠️ tmp 也要读。写增量是 write tmp → delete delta → rename tmp→delta:
    // 在 delete 之后、rename 之前被杀掉的话,**完整的新增量只剩 tmp 那一份**,
    // 只认 delta 等于把它扔了。半份 tmp(writeFile 途中被杀)解析不出 JSON,
    // 由 replayDeltaRecord 的 catch 丢掉,所以多读这一个候选是安全的。
    for (const path of [DB_FILE_DELTA, DB_FILE_DELTA_TMP]) {
      try {
        const { data } = await Filesystem.readFile({ path, directory: DB_DIRECTORY, encoding: Encoding.UTF8 });
        if (typeof data === 'string' && data) return data;
      } catch {
        continue;
      }
    }
    return null;
  }
  const browserDb = await openBrowserDatabase();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = browserDb.transaction(BROWSER_DB_STORE, 'readonly').objectStore(BROWSER_DB_STORE).get(BROWSER_DELTA_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  browserDb.close();
  return typeof value === 'string' ? value : null;
};

const removeDeltaRecord = async (): Promise<void> => {
  if (isNativeFileStorage()) {
    await deleteFileIfExists(DB_FILE_DELTA);
    await deleteFileIfExists(DB_FILE_DELTA_TMP);
    return;
  }
  const browserDb = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = browserDb.transaction(BROWSER_DB_STORE, 'readwrite');
    transaction.objectStore(BROWSER_DB_STORE).delete(BROWSER_DELTA_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to clear delta'));
  });
  browserDb.close();
};

/**
 * 启动时把增量放回去。
 *
 * ⚠️ `delta.to <= 快照自带的 mark` 一定要跳过:那说明这份增量比快照还旧,
 * 放上去等于拿旧值盖掉新值。正常情况下整库落盘之后就把增量删了,这条是兜底
 * (比如删增量那一步没跑完就被杀掉)。
 *
 * ⚠️ 坏掉的增量不许拖垮启动:解析不了就丢掉,大不了回到快照那一刻。
 */
const replayDeltaRecord = async (): Promise<void> => {
  try {
    const raw = await readDeltaRecord();
    if (!raw) return;
    const delta = JSON.parse(raw) as LocalDelta;
    if (!delta?.to || delta.to <= readSnapshotMark()) return;
    applyDelta(delta);
    console.log('✅ 本机增量已回放');
  } catch (error) {
    // 回放本身是原子的(applyDelta 自带事务),失败时库还停在快照那一刻。
    // 但那份增量里的改动就此没人认领了,所以**原样留一份**再走 —— 下一次落盘
    // 会把 delta 覆盖掉,不另存的话它连查都没得查。
    await stashFailedDelta().catch(() => undefined);
    console.error('[storage] 本机增量回放失败,已按快照那一刻启动(增量已另存):', error);
    notifyPersistenceError();
  }
};

/** 回放失败的增量原样另存一份,不参与下次启动。 */
const stashFailedDelta = async (): Promise<void> => {
  const raw = await readDeltaRecord();
  if (!raw) return;
  if (isNativeFileStorage()) {
    await Filesystem.writeFile({
      path: DB_FILE_DELTA_FAILED, data: raw, directory: DB_DIRECTORY, encoding: Encoding.UTF8, recursive: true
    });
    return;
  }
  const browserDb = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = browserDb.transaction(BROWSER_DB_STORE, 'readwrite');
    transaction.objectStore(BROWSER_DB_STORE).put(raw, `${BROWSER_RECOVERY_KEY_PREFIX}failed-delta`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to stash failed delta'));
  });
  browserDb.close();
};

const bytesToBase64 = (data: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.slice(index, index + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    data[i] = binary.charCodeAt(i);
  }
  return data;
};

const chunkKey = (index: number) => `${DB_CHUNK_KEY_PREFIX}${index}`;

const removeChunkedDatabase = async (chunkCount = 80): Promise<void> => {
  await Preferences.remove({ key: DB_MANIFEST_KEY });
  for (let index = 0; index < chunkCount; index += 1) {
    await Preferences.remove({ key: chunkKey(index) });
  }
};

const loadChunkedDatabase = async (): Promise<string | null> => {
  const { value } = await Preferences.get({ key: DB_MANIFEST_KEY });
  if (!value) return null;

  const manifest = JSON.parse(value) as { chunkCount?: number; length?: number };
  const chunkCount = Number(manifest.chunkCount) || 0;
  if (chunkCount <= 0) return null;

  const parts: string[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const part = await Preferences.get({ key: chunkKey(index) });
    if (!part.value) throw new Error(`Missing database chunk ${index}`);
    parts.push(part.value);
  }

  const base64 = parts.join("");
  if (manifest.length && base64.length !== manifest.length) {
    throw new Error("Saved database is incomplete");
  }
  return base64;
};

const loadLegacyBase64 = async (): Promise<string | null> => {
  const chunked = await loadChunkedDatabase().catch(() => null);
  if (chunked) return chunked;
  const legacy = await Preferences.get({ key: DB_KEY });
  return legacy.value ?? null;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await Filesystem.stat({ path, directory: DB_DIRECTORY });
    return true;
  } catch {
    return false;
  }
};

const deleteFileIfExists = async (path: string): Promise<void> => {
  try {
    await Filesystem.deleteFile({ path, directory: DB_DIRECTORY });
  } catch {
    // 文件不存在时忽略
  }
};

const saveFileDatabase = async (base64: string): Promise<void> => {
  await Filesystem.writeFile({
    path: DB_FILE_TMP,
    data: base64,
    directory: DB_DIRECTORY,
    recursive: true
  });
  if (await fileExists(DB_FILE_MAIN)) {
    await deleteFileIfExists(DB_FILE_PREV);
    await Filesystem.rename({
      from: DB_FILE_MAIN,
      to: DB_FILE_PREV,
      directory: DB_DIRECTORY,
      toDirectory: DB_DIRECTORY
    });
  }
  await Filesystem.rename({
    from: DB_FILE_TMP,
    to: DB_FILE_MAIN,
    directory: DB_DIRECTORY,
    toDirectory: DB_DIRECTORY
  });
};

const loadFileDatabase = async (): Promise<boolean> => {
  // main 是最新完整版本;tmp 只在"写完但还没轮转完"被中断时存在,
  // 内容完整且比 main 新;prev 是上一代备份。
  let sawArchive = false;
  let lastError: unknown = null;
  for (const path of [DB_FILE_MAIN, DB_FILE_TMP, DB_FILE_PREV]) {
    try {
      const { data } = await Filesystem.readFile({ path, directory: DB_DIRECTORY });
      if (typeof data !== 'string' || !data) continue;
      sawArchive = true;
      await importDatabase(base64ToBytes(data), { validateBackup: true });
      if (path !== DB_FILE_MAIN) {
        console.warn(`[storage] 主数据库文件不可用，已从 ${path} 恢复`);
      }
      return true;
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  // 三代都在、三代都打不开 ≠ 首次安装。文件原样留在磁盘上,不许自动重建。
  if (sawArchive) throw new LocalArchiveUnreadableError(null, lastError);
  return false;
};

/**
 * 落盘串行队列。
 *
 * ⚠️ 定时保存、页面隐藏兜底、显式 saveDatabase 三条路都能同时进到写盘流程,
 * 而它们共用 tmp 文件、pendingSave 和快照基准。实测:让旧的那次晚一点完成,
 * 主文件就从新版本退回旧版本。**所有落盘一律排队走**,一次只有一个在写。
 */
let writeQueue: Promise<unknown> = Promise.resolve();
const enqueueWrite = <T>(task: () => Promise<T>): Promise<T> => {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
};

// 保存数据库到本地存储。云同步通知默认打开,从云端恢复时显式关闭,
// 避免把刚拉下来的云端备份又当成本机新修改推回去。
export function saveDatabase(options: { notifyCloud?: boolean } = {}): Promise<void> {
  return enqueueWrite(() => saveDatabaseNow(options));
}

async function saveDatabaseNow(options: { notifyCloud?: boolean } = {}): Promise<void> {
  const { notifyCloud = true } = options;
  if (notifyCloud) localDataRevision += 1;
  const revisionAtStart = localDataRevision;
  try {
    // 水位线写进库里再导出 —— 这样快照自带「我是哪一刻的」,不用另存一个 mark 文件,
    // 也就不会出现「mark 写成功了快照没写成功」这种对不上的中间态。
    try {
      stampSnapshotMark(currentMark());
    } catch {
      // 库还没起来,下面 exportDatabase() 会返回 null
    }
    const data = exportDatabase();
    if (!data) {
      console.warn('No database to save');
      return;
    }

    if (isNativeFileStorage()) {
      await saveFileDatabase(bytesToBase64(data));
    } else {
      await saveBrowserDatabase(data);
      // 顺手把整库镜像到 frontend/.local/live.db,好让命令行查得到今天的真实状态。
      if (import.meta.env.DEV) {
        void import('./dev-snapshot').then(({ mirrorLiveSnapshot }) => mirrorLiveSnapshot(data)).catch(() => undefined);
      }
    }
    // ⚠️ 只有「写盘期间没有新改动」才算清账。写这一份的几百毫秒里用户又答了题的话,
    // pendingSave 得留着,否则退到后台时 flushPendingSave 会以为没东西要写。
    if (localDataRevision === revisionAtStart) pendingSave = false;
    // ⚠️ 顺序不能反:快照写成功了才删增量。反过来的话,中间被杀掉就两头空。
    await removeDeltaRecord().catch(() => undefined);
    snapshotDb = safeDatabase();
    snapshotAt = Date.now();

    console.log('✅ Database saved to local storage');
    notifyPersistenceOk();
    if (notifyCloud && typeof window !== 'undefined') {
      void import('./sync-api')
        .then(({ requestCloudAutoSync }) => requestCloudAutoSync('local-change'))
        .catch(() => undefined);
    }
  } catch (error) {
    console.error('❌ Failed to save database:', error);
    notifyPersistenceError();
    throw error;
  }
}

// 从本地存储恢复数据库
export async function loadDatabase(): Promise<boolean> {
  try {
    if (isNativeFileStorage()) {
      if (await loadFileDatabase()) {
        await replayDeltaRecord();
        markSnapshotLoaded();
        return true;
      }

      // 从旧的 Preferences 分块存储迁移到文件存储(一次性)。
      const legacy = await loadLegacyBase64();
      if (legacy) {
        await importDatabase(base64ToBytes(legacy));
        await saveFileDatabase(legacy);
        await removeChunkedDatabase();
        await Preferences.remove({ key: DB_KEY });
        console.log('✅ Database migrated from Preferences to Filesystem');
        return true;
      }
      console.log('No saved database found');
      return false;
    }

    const browserData = await loadBrowserDatabase();
    if (browserData) {
      try {
        await importDatabase(browserData, { validateBackup: true });
      } catch (error) {
        // 「有存档但打不开」和「没有存档」在这里必须分开:后者才该去加载出厂库。
        await stashUnreadableBrowserDatabase(browserData).catch(() => undefined);
        throw new LocalArchiveUnreadableError(browserData, error);
      }
      await replayDeltaRecord();
      markSnapshotLoaded();
      console.log('✅ Database loaded from IndexedDB');
      // 开着 dev server 打开页面就先落一份快照,不必等到答完第一题。
      if (import.meta.env.DEV) {
        void import('./dev-snapshot')
          .then(({ mirrorLiveSnapshot }) => mirrorLiveSnapshot(browserData, { force: true }))
          .catch(() => undefined);
      }
      return true;
    }

    // 兼容旧版浏览器 localStorage 数据，并在首次读取后迁移到 IndexedDB。
    const value = await loadLegacyBase64();
    if (!value) {
      console.log('No saved database found');
      return false;
    }

    const legacyData = base64ToBytes(value);
    await importDatabase(legacyData, { validateBackup: true });
    await saveBrowserDatabase(legacyData);
    await removeChunkedDatabase();
    await Preferences.remove({ key: DB_KEY });
    console.log('✅ Database migrated from local storage to IndexedDB');
    return true;
  } catch (error) {
    console.error('❌ Failed to load database:', error);
    // ⚠️ 「打不开」不能退化成「没有」—— 那条路会静默拿出厂库盖掉用户的存档。
    if (error instanceof LocalArchiveUnreadableError) throw error;
    return false;
  }
}

/**
 * 恢复一份完整的本机备份(设置页「导入学习数据」)。
 *
 * ⚠️ **必须换设备号。** 备份里带着导出那台设备的 sync_device 行,而作答流水的
 * 跨端身份 `sync_uid` 就是「设备号 : 本机自增 id」—— 两台设备从同一份备份出发、
 * 各自答一道**不同**的题,会生成一模一样的 uid,云端按 uid 合并时把两次不同的
 * 作答当成同一件事,后到的那条直接丢掉。已有的历史流水保留原来的 uid(它们
 * 确实是那台设备产生的),只有本机之后新产生的行用新号。
 *
 * ⚠️ 这一条只属于「用户主动导入整库备份」。普通启动恢复不能每次换号 ——
 * 那样每次重启都是一台新设备,墓碑和 append 表的来源全乱。
 */
export async function restoreDatabaseBackup(data: Uint8Array): Promise<void> {
  await importDatabase(data, { validateBackup: true });
  ensureSyncSchema();
  resetDeviceId();
  await saveDatabase();
}

// 清除本地存储
export async function clearStorage(): Promise<void> {
  try {
    await Preferences.remove({ key: DB_KEY });
    // 增量必须跟着一起清:留着的话下次启动会把它回放到刚重建的出厂库上,
    // 「清除数据」就成了「清一半」。
    await removeDeltaRecord().catch(() => undefined);
    snapshotDb = null;
    await removeChunkedDatabase();
    if (isNativeFileStorage()) {
      await deleteFileIfExists(DB_FILE_MAIN);
      await deleteFileIfExists(DB_FILE_TMP);
      await deleteFileIfExists(DB_FILE_PREV);
    } else {
      await clearBrowserDatabase();
    }
    console.log('✅ Local storage cleared');
  } catch (error) {
    console.error('❌ Failed to clear storage:', error);
    throw error;
  }
}

// 自动保存功能（每次提交答案后调用）
let autoSaveTimer: NodeJS.Timeout | null = null;
let pendingSave = false;
// 网络同步可能持续数秒;用运行期版本号判断期间是否又有本地改动,
// 防止后台拉取覆盖用户刚答完的题。它不需要持久化。
let localDataRevision = 0;

/** 上一份整库快照是从哪个 db 实例导出的、什么时候导的。 */
let snapshotDb: object | null = null;
let snapshotAt = 0;

/**
 * 整库落盘的间隔上限。
 *
 * 以前每次 scheduleSave 都是整库:实测 35.9 MB,浏览器端占住主线程 100~510ms,
 * 原生端还要先 base64(36MB → 48MB 字符串)。而 debounce 只有 2 秒 ——
 * 真人节奏下等于**每答一张卡冻一次**。
 *
 * 现在中间只写增量(几百行的 JSON),整库最多 5 分钟一次。答题时约 35 张卡才碰
 * 一次整库,其余都是几毫秒的小写入。代价:硬崩溃(不是正常退到后台/关页面 ——
 * 那两条都会 flushPendingSave 写增量)最多丢到上一次增量为止,也就是 2 秒。
 */
const FULL_SNAPSHOT_INTERVAL_MS = 5 * 60_000;

/** 增量大到这个份上就不如直接整库(词单导入这种一次改上万行的场合)。 */
const DELTA_ROW_LIMIT = 20_000;

/** DEV 下把整库镜像到 .local/live.db 的最小间隔(和 dev-snapshot 里那道闸同一个数)。 */
const DEV_MIRROR_INTERVAL_MS = 20_000;
let devMirroredAt = 0;

const safeDatabase = (): object | null => {
  try {
    return getDatabase() as unknown as object;
  } catch {
    return null;
  }
};

/**
 * ⚠️ `snapshotDb !== 当前 db` 这一条是必须的:恢复备份、导入、云同步合并都会整个
 * 换掉 db 实例,而磁盘上那份快照还是换之前的。这时候写增量 = 把新库的行贴到旧库的
 * 快照上,重启后是一份两边拼起来的假数据。换库之后第一次落盘一律整库。
 */
const needsFullSnapshot = (): boolean =>
  snapshotDb === null
  || snapshotDb !== safeDatabase()
  || Date.now() - snapshotAt > FULL_SNAPSHOT_INTERVAL_MS;

/**
 * 磁盘上已经有一份对得上当前 db 的快照(启动时刚读进来的那份)。
 * 不认这一条的话,进 App 之后第一次改动就要整库重写一遍,白扔一秒。
 */
const markSnapshotLoaded = (): void => {
  snapshotDb = safeDatabase();
  snapshotAt = Date.now();
};

/** 下一次落盘强制整库(词单导入、合并重复词条这类会动 words 表的路要自己喊)。 */
export function requestFullSnapshot(): void {
  snapshotDb = null;
}

const mirrorForDev = (): void => {
  if (!import.meta.env.DEV || isNativeFileStorage()) return;
  const now = Date.now();
  // 自己先挡一道:不挡的话每写一次增量都要为了镜像整库 export 一遍。
  if (now - devMirroredAt < DEV_MIRROR_INTERVAL_MS) return;
  devMirroredAt = now;
  const bytes = exportDatabase();
  if (!bytes) return;
  void import('./dev-snapshot').then(({ mirrorLiveSnapshot }) => mirrorLiveSnapshot(bytes)).catch(() => undefined);
};

/**
 * 真正落盘的那一下:够条件就整库,否则只写「快照之后改过的行」。
 * ⚠️ 整库和增量共用一条串行队列(见 enqueueWrite),所以这里只调 saveDatabaseNow ——
 * 调 saveDatabase 会在自己的队列格子里再排一次队,直接死锁。
 */
const persistNow = (): Promise<void> => enqueueWrite(persistNowInQueue);

const persistNowInQueue = async (): Promise<void> => {
  if (needsFullSnapshot()) {
    await saveDatabaseNow();
    return;
  }
  const revisionAtStart = localDataRevision;
  try {
    const since = readSnapshotMark();
    // 老装机(或刚清过数据)的库里还没有水位线 —— 没有基准就无从算增量,
    // 而且拿空串去收会把整库都收进来。先整库落一次,把水位线种下去。
    if (!since) {
      await saveDatabaseNow();
      return;
    }
    const delta = collectDelta(since);
    if (deltaRowCount(delta) > DELTA_ROW_LIMIT) {
      await saveDatabaseNow();
      return;
    }
    await saveDeltaRecord(JSON.stringify(delta));
    if (localDataRevision === revisionAtStart) pendingSave = false;
    notifyPersistenceOk();
    mirrorForDev();
    if (typeof window !== 'undefined') {
      void import('./sync-api')
        .then(({ requestCloudAutoSync }) => requestCloudAutoSync('local-change'))
        .catch(() => undefined);
    }
  } catch (error) {
    // 增量写不下去就退回整库 —— 慢,但不能让这次改动丢了。
    console.warn('[storage] 增量写入失败,改写整库:', error);
    await saveDatabaseNow();
  }
};

export function getLocalDataRevision(): number {
  return localDataRevision;
}

export function scheduleSave(delayMs: number = 2000): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }

  localDataRevision += 1;
  pendingSave = true;
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    persistNow().catch(console.error);
  }, delayMs);
}

// 立即写盘(仅当有待保存的改动时),用于 App 退到后台/页面隐藏时兜底,
// 避免 2 秒 debounce 窗口内被杀掉丢进度。
//
// ⚠️ 这里走的是 persistNow 而不是 saveDatabase:被叫到这一步时页面随时可能被杀,
// 写一份几百行的增量比写 36MB 靠谱得多。整库交给上面那条 5 分钟的上限。
export async function flushPendingSave(): Promise<void> {
  if (!pendingSave) return;
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  await persistNow().catch(console.error);
}

let lifecycleRegistered = false;

export function registerPersistenceLifecycle(): void {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushPendingSave();
    }
  });
  window.addEventListener('pagehide', () => {
    void flushPendingSave();
  });
}
