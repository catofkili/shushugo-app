import config from '../../../wechat-miniprogram/src/config';
import { readyForPage } from '../../scripts/taro-content.cjs';
import { downloadFile, readCompressedFile, readFile, removeFile } from '../../../wechat-miniprogram/src/runtime/wx-promise';
import { ensureUserTables } from '../../../frontend/src/lib/study-core';
import { getDatabase, importDatabase } from '../../../frontend/src/lib/database';
import { loadDatabase, registerPersistenceLifecycle, saveDatabase } from '../../../frontend/src/lib/storage';
import { ensureSyncSchema } from '../../../frontend/src/lib/sync/schema';

let opening: Promise<unknown> | null = null;
type StartupObserver = {
  onStage?: (name: string, elapsedMs: number) => void;
  onDownload?: (progress: { compressed: boolean; percent: number | null; fallback?: boolean }) => void;
};

const elapsed = (started: number) => Math.max(0, Math.round(Date.now() - started));

async function downloadSeed(url: string, compressed: boolean, observer?: StartupObserver) {
  const tempPath = await downloadFile(url, {
    onProgress: (event) => observer?.onDownload?.({
      compressed,
      percent: Number.isFinite(Number(event?.progress)) ? Number(event.progress) : null
    })
  });
  try {
    if (!compressed) return await readFile(tempPath);
    const started = Date.now();
    const decompressed = await readCompressedFile(tempPath, 'br');
    observer?.onStage?.('seed-decompress', elapsed(started));
    return decompressed;
  } finally {
    await removeFile(tempPath).catch(() => undefined);
  }
}

export async function ensureDatabase(
  contentPage: 'word-study' | 'vocab-test' | 'confusion-quiz' | 'kanji-reading' | 'grammar-quiz' = 'word-study',
  observer?: StartupObserver
) {
  let started = Date.now();
  await readyForPage(contentPage);
  observer?.onStage?.('page-content', elapsed(started));

  if (!opening) opening = (async () => {
    started = Date.now();
    const restored = await loadDatabase();
    observer?.onStage?.('local-database', elapsed(started));
    if (!restored) {
      if (!config.seedDatabaseUrl) throw new Error('微信云存储未配置出厂数据库');
      // ⚠️ 必须是 Brotli：微信 FileSystemManager.readCompressedFile 的 compressionAlgorithm「目前仅支持 br」。
      // 2026-09-27 之前下的是 .db.gz —— 真机上解压必定失败，每个新用户都是先白下 2.2 MB、再回退下 11.5 MB 原库。
      // Brotli 版 1.34 MB，原生解压（Node 里 16 ms）。上传见 wechat-miniprogram/scripts/upload-cloud-content.sh。
      const brUrl = config.seedDatabaseBrUrl || config.seedDatabaseUrl.replace(/\.db(?=($|[?#]))/, '.db.br');
      let seed: Uint8Array | null = null;
      if (brUrl && brUrl !== config.seedDatabaseUrl) {
        started = Date.now();
        try {
          observer?.onDownload?.({ compressed: true, percent: 0 });
          seed = await downloadSeed(brUrl, true, observer);
          observer?.onStage?.('seed-download', elapsed(started));
        } catch (error) {
          console.warn('[database] 压缩出厂库不可用，回退原库', error);
          observer?.onDownload?.({ compressed: false, percent: 0, fallback: true });
        }
      }
      if (!seed) {
        started = Date.now();
        seed = await downloadSeed(config.seedDatabaseUrl, false, observer);
        observer?.onStage?.('seed-download', elapsed(started));
      }
      started = Date.now();
      await importDatabase(seed, { validateBackup: true });
      observer?.onStage?.('database-import', elapsed(started));
    }
    // Seed-content migrations import web-only catalog modules guarded out of Mini Program bundles.
    started = Date.now();
    ensureUserTables();
    observer?.onStage?.('user-schema', elapsed(started));
    started = Date.now();
    ensureSyncSchema();
    observer?.onStage?.('sync-schema', elapsed(started));
    registerPersistenceLifecycle();
    if (!restored) {
      started = Date.now();
      await saveDatabase({ notifyCloud: false });
      observer?.onStage?.('first-save', elapsed(started));
    }
    return getDatabase();
  })().catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}
