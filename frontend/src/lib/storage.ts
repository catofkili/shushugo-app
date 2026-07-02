import { Preferences } from '@capacitor/preferences';
import { exportDatabase, importDatabase } from './database';

const DB_KEY = 'nihongo_db';
const DB_MANIFEST_KEY = 'nihongo_db_manifest';
const DB_CHUNK_KEY_PREFIX = 'nihongo_db_chunk_';
const DB_CHUNK_SIZE = 350_000;

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

const saveChunkedDatabase = async (base64: string): Promise<void> => {
  const chunkCount = Math.ceil(base64.length / DB_CHUNK_SIZE);
  const previous = await Preferences.get({ key: DB_MANIFEST_KEY });
  let previousChunkCount = 0;
  if (previous.value) {
    try {
      previousChunkCount = Number(JSON.parse(previous.value).chunkCount) || 0;
    } catch {
      previousChunkCount = 0;
    }
  }

  for (let index = 0; index < chunkCount; index += 1) {
    await Preferences.set({
      key: chunkKey(index),
      value: base64.slice(index * DB_CHUNK_SIZE, (index + 1) * DB_CHUNK_SIZE)
    });
  }

  for (let index = chunkCount; index < previousChunkCount; index += 1) {
    await Preferences.remove({ key: chunkKey(index) });
  }

  await Preferences.set({
    key: DB_MANIFEST_KEY,
    value: JSON.stringify({ version: 1, chunkCount, length: base64.length })
  });
  await Preferences.remove({ key: DB_KEY });
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

// 保存数据库到本地存储
export async function saveDatabase(): Promise<void> {
  try {
    const data = exportDatabase();
    if (!data) {
      console.warn('No database to save');
      return;
    }

    // 转换为 Base64 字符串。分块写入 Preferences，避免单个值过大导致保存失败。
    const base64 = bytesToBase64(data);
    await saveChunkedDatabase(base64);

    console.log('✅ Database saved to local storage');
  } catch (error) {
    console.error('❌ Failed to save database:', error);
    throw error;
  }
}

// 从本地存储恢复数据库
export async function loadDatabase(): Promise<boolean> {
  try {
    let value = await loadChunkedDatabase();

    if (!value) {
      const legacy = await Preferences.get({ key: DB_KEY });
      value = legacy.value;
    }

    if (!value) {
      console.log('No saved database found');
      return false;
    }

    await importDatabase(base64ToBytes(value));
    console.log('✅ Database loaded from local storage');
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
    console.log('✅ Local storage cleared');
  } catch (error) {
    console.error('❌ Failed to clear storage:', error);
    throw error;
  }
}

// 自动保存功能（每次提交答案后调用）
let autoSaveTimer: NodeJS.Timeout | null = null;

export function scheduleSave(delayMs: number = 2000): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }

  autoSaveTimer = setTimeout(() => {
    saveDatabase().catch(console.error);
  }, delayMs);
}
