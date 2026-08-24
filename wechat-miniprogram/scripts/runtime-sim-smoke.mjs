import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shushugo-wx-'));
const localPath = (filePath) => filePath.startsWith(dataRoot) ? filePath : filePath;
const callback = (_ignored, result, hooks) => setTimeout(() => (hooks?.fail && result == null ? hooks.fail(new Error('mock fs failure')) : hooks?.success?.(result)), 0);

const fileSystem = {
  readFile({ filePath, success, fail }) {
    try { const data = fs.readFileSync(localPath(filePath)); callback(null, { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }, { success, fail }); }
    catch (error) { callback(null, null, { success, fail }); }
  },
  writeFile({ filePath, data, success, fail }) {
    try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, Buffer.from(data)); callback(null, {}, { success, fail }); }
    catch (error) { callback(null, null, { success, fail }); }
  },
  unlink({ filePath, success, fail }) { try { fs.unlinkSync(filePath); callback(null, {}, { success, fail }); } catch (error) { callback(null, null, { success, fail }); } },
  rename({ oldPath, newPath, success, fail }) { try { fs.renameSync(oldPath, newPath); callback(null, {}, { success, fail }); } catch (error) { callback(null, null, { success, fail }); } },
  access({ path: filePath, success, fail }) { try { fs.accessSync(filePath); callback(null, {}, { success, fail }); } catch (error) { callback(null, null, { success, fail }); } },
  mkdir({ dirPath, recursive, success, fail }) { try { fs.mkdirSync(dirPath, { recursive }); callback(null, {}, { success, fail }); } catch (error) { callback(null, null, { success, fail }); } }
};

global.wx = { env: { USER_DATA_PATH: dataRoot }, getFileSystemManager: () => fileSystem };
global.WXWebAssembly = {
  async instantiate(assetPath, imports) {
    const bytes = fs.readFileSync(path.resolve(root, 'src/assets/sql-wasm.wasm'));
    return WebAssembly.instantiate(bytes, imports);
  }
};

const config = require('../src/config');
config.seedDatabasePath = path.resolve(root, '../frontend/public/nihongo.db');
const store = require('../src/runtime/database-store');
const learning = require('../src/runtime/learning');
const core = require('../src/core/study-core');

const database = await store.ensureDatabase();
const card = core.nextCard(database, { now: new Date('2026-08-22T12:00:00+08:00'), newLimit: 1, reviewLimit: 0 });
assert.ok(card?.id);
await learning.answerCard(card.id, 'know', { now: new Date('2026-08-22T12:00:00+08:00') });
await store.saveDatabase();
const dbPath = store.databasePaths().dbPath;
const prevPath = store.databasePaths().prevPath;
assert.equal(fs.existsSync(dbPath), true);
await store.saveDatabase();
assert.equal(fs.existsSync(prevPath), true, '第二次保存后应有 prev 快照');
fs.writeFileSync(dbPath, Buffer.from('corrupted database'));
await store.closeDatabase();
const restored = await store.restoreDatabase();
assert.equal(Number(restored.exec('SELECT COUNT(*) FROM words')[0].values[0][0]), 10919);
console.log(JSON.stringify({ ok: true, dataRoot, source: store.getStatus().source, bytes: fs.statSync(prevPath).size }, null, 2));
