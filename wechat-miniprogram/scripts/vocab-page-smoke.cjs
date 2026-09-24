const assert = require('node:assert/strict');

const databasePath = require.resolve('../src/runtime/database-store');
const featuresPath = require.resolve('../src/runtime/extended-features');
require.cache[databasePath] = { exports: { ensureDatabase: async () => undefined, getStatus: () => ({ ready: true }) } };
require.cache[featuresPath] = { exports: { vocabTest: {
  history: () => [
    { runId: 'short', answered: 8, estimated: 0, finishedAt: Date.now(), lower: 0, upper: 100, durationSeconds: 60, confidence: 5 },
    { runId: 'valid', answered: 24, estimated: 4200, scoringVersion: 2, finishedAt: Date.now() - 86_400_000, lower: 3900, upper: 4500, durationSeconds: 240, confidence: 80 }
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
