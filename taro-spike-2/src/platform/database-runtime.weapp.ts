import config from '../../../wechat-miniprogram/src/config';
import { readyForKanji } from '../../scripts/taro-content.cjs';
import { downloadFile, readFile, removeFile } from '../../../wechat-miniprogram/src/runtime/wx-promise';
import { ensureUserTables } from '../../../frontend/src/lib/study-core';
import { getDatabase, importDatabase } from '../../../frontend/src/lib/database';
import { loadDatabase, registerPersistenceLifecycle, saveDatabase } from '../../../frontend/src/lib/storage';
import { ensureSyncSchema } from '../../../frontend/src/lib/sync/schema';

let opening: Promise<unknown> | null = null;

export function ensureDatabase() {
  opening ||= (async () => {
    await readyForKanji();
    const restored = await loadDatabase();
    if (!restored) {
      if (!config.seedDatabaseUrl) throw new Error('微信云存储未配置出厂数据库');
      const tempPath = await downloadFile(config.seedDatabaseUrl);
      try {
        await importDatabase(await readFile(tempPath), { validateBackup: true });
      } finally {
        await removeFile(tempPath).catch(() => undefined);
      }
    }
    // Seed-content migrations import web-only catalog modules guarded out of Mini Program bundles.
    ensureUserTables();
    ensureSyncSchema();
    registerPersistenceLifecycle();
    if (!restored) await saveDatabase({ notifyCloud: false });
    return getDatabase();
  })().catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}
