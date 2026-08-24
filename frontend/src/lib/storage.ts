import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { exportDatabase, importDatabase } from './database';

// 供当前页面把“数据库写盘失败”显示出来；旧版 localStorage 配额异常曾被静默吞掉。
export const PERSISTENCE_ERROR_EVENT = 'persistence-error';

const notifyPersistenceError = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PERSISTENCE_ERROR_EVENT));
};

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

// 浏览器端不能把整份 SQLite 数据库存进 localStorage：它有严格的容量限制，
// 大一点的个人学习库会在“恢复备份”时写入失败。IndexedDB 专门用于二进制数据。
const BROWSER_DB_NAME = 'master-nihongo-storage';
const BROWSER_DB_STORE = 'databases';
const BROWSER_DB_KEY = 'study-database';
const BROWSER_RECOVERY_KEY_PREFIX = 'recovery-';

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
  for (const path of [DB_FILE_MAIN, DB_FILE_TMP, DB_FILE_PREV]) {
    try {
      const { data } = await Filesystem.readFile({ path, directory: DB_DIRECTORY });
      if (typeof data !== 'string' || !data) continue;
      await importDatabase(base64ToBytes(data), { validateBackup: true });
      if (path !== DB_FILE_MAIN) {
        console.warn(`[storage] 主数据库文件不可用，已从 ${path} 恢复`);
      }
      return true;
    } catch {
      continue;
    }
  }
  return false;
};

// 保存数据库到本地存储。云同步通知默认打开,从云端恢复时显式关闭,
// 避免把刚拉下来的云端备份又当成本机新修改推回去。
export async function saveDatabase(options: { notifyCloud?: boolean } = {}): Promise<void> {
  const { notifyCloud = true } = options;
  if (notifyCloud) localDataRevision += 1;
  try {
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
    pendingSave = false;

    console.log('✅ Database saved to local storage');
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
      if (await loadFileDatabase()) return true;

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
      await importDatabase(browserData, { validateBackup: true });
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
    return false;
  }
}

// 清除本地存储
export async function clearStorage(): Promise<void> {
  try {
    await Preferences.remove({ key: DB_KEY });
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
    saveDatabase().catch(console.error);
  }, delayMs);
}

// 立即写盘(仅当有待保存的改动时),用于 App 退到后台/页面隐藏时兜底,
// 避免 2 秒 debounce 窗口内被杀掉丢进度。
export async function flushPendingSave(): Promise<void> {
  if (!pendingSave) return;
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  await saveDatabase().catch(console.error);
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
