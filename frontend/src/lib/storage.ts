import { Preferences } from '@capacitor/preferences';
import { exportDatabase, importDatabase } from './database';

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

// 保存数据库到本地存储
export async function saveDatabase(): Promise<void> {
  try {
    const data = exportDatabase();
    if (!data) {
      console.warn('No database to save');
      return;
    }

    // 转换为 Base64 字符串。分块处理可以避免较大的数据库触发调用栈溢出。
    const base64 = bytesToBase64(data);
    await Preferences.set({
      key: 'nihongo_db',
      value: base64,
    });

    console.log('✅ Database saved to local storage');
  } catch (error) {
    console.error('❌ Failed to save database:', error);
    throw error;
  }
}

// 从本地存储恢复数据库
export async function loadDatabase(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: 'nihongo_db' });

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
    await Preferences.remove({ key: 'nihongo_db' });
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
