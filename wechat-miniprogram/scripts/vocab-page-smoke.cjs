const assert = require('node:assert/strict');

const databasePath = require.resolve('../src/runtime/database-store');
const featuresPath = require.resolve('../src/runtime/extended-features');
require.cache[databasePath] = { exports: { ensureDatabase: async () => undefined, getStatus: () => ({ ready: true }) } };
require.cache[featuresPath] = { exports: { vocabTest: {
  PENALTY_V3: 0.80,
  history: () => [
    { runId: 'short', answered: 8, estimated: 0, finishedAt: Date.now(), lower: 0, upper: 100, durationSeconds: 60, confidence: 5 },
    { runId: 'valid', answered: 24, estimated: 4200, scoreVersion: 3, finishedAt: Date.now() - 86_400_000, lower: 3900, upper: 4500, durationSeconds: 240, confidence: 80 }
  ],
  session: () => null
} } };
global.wx = { hideShareMenu: () => undefined };
let page;
global.Page = (definition) => { page = definition; };
require('../src/features/vocab-test/index');
page.setData = (next) => Object.assign(page.data, next);
page.refreshHome();

assert.equal(page.data.history[0].tooFew, true);
assert.equal(page.data.latest.runId, 'valid', 'a run with fewer than 15 answers must not become the latest estimate');
console.log('OK mini program ignores short vocabulary runs as estimates');

(async () => {
  await page.onLoad({ share: 'vocab', scoringVersion: '3', answered: '80', total: '80', estimate: '3490' });
  assert.equal(page.data.sharedResult.scoreVersion, 3, 'shared v3 must not fall back to v1');
  await page.onLoad({ share: 'vocab', scoringVersion: '2', answered: '60' });
  assert.equal(page.data.sharedResult.scoreVersion, 2);
  await page.onLoad({ share: 'vocab', answered: '60' });
  assert.equal(page.data.sharedResult.scoreVersion, 1);
  console.log('OK vocabulary share keeps v1/v2/v3 scoring versions');
})().catch((error) => { console.error(error); process.exitCode = 1; });
