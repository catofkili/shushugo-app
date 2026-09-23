// Isolated Chromium profile + dedicated Vite port; never attach to a study browser.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const origin = 'http://127.0.0.1:5189';
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  // Isolated worktrees can symlink node_modules; never share the live Vite cache.
  cacheDir: fileURLToPath(new URL('../.vite-sync-browser-cache', import.meta.url)),
  server: { host: '127.0.0.1', port: 5189, strictPort: true }
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/__sync-test') return route.fulfill({ contentType: 'text/html', body: '<html><body>isolated sync test</body></html>' });
    return route.continue();
  });
  const a = await context.newPage();
  await a.goto(`${origin}/__sync-test`);
  assert.equal(await a.evaluate(async () => {
    const storage = await import('/src/lib/storage.ts');
    const exists = await storage.loadDatabase();
    const { initDatabase } = await import('/src/lib/database.ts');
    await initDatabase();
    const { ensureUserTables } = await import('/src/lib/study-core.ts');
    ensureUserTables();
    const { ensureSyncSchema } = await import('/src/lib/sync/schema.ts');
    ensureSyncSchema();
    await storage.saveDatabase();
    return exists;
  }), false);
  await a.waitForTimeout(20);
  await a.evaluate(async () => {
    const { getDatabase } = await import('/src/lib/database.ts');
    getDatabase().run("INSERT INTO reviews(word_id,answer,score_after,reviewed_on) VALUES(1,'know',1,'2030-01-01')");
    const storage = await import('/src/lib/storage.ts');
    storage.scheduleSave(60_000);
    await storage.flushPendingSave();
  });
  const b = await context.newPage();
  await b.goto(origin);
  await b.getByText('请使用一个学习窗口', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await b.evaluate(async () => {
    try { await (await import('/src/lib/storage.ts')).saveDatabase(); return 'unsafe'; }
    catch (error) { return error.name; }
  }), 'BrowserDatabaseInUseError');
  await a.close();
  await b.close();
  const reopened = await context.newPage();
  await reopened.goto(`${origin}/__sync-test`);
  const restored = await reopened.evaluate(async () => {
    const storage = await import('/src/lib/storage.ts');
    const loaded = await storage.loadDatabase();
    const { getDatabase } = await import('/src/lib/database.ts');
    return { loaded, answers: getDatabase().exec('SELECT COUNT(*) FROM reviews')[0].values[0][0] };
  });
  assert.deepEqual(restored, { loaded: true, answers: 1 });
  console.log(JSON.stringify({ ok: true, browser: await browser.version(), origin, secondWindowBlocked: true, restored }));
} finally {
  await browser?.close();
  await server.close();
}
