const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const config = require(path.join(repoRoot, 'wechat-miniprogram/src/config.js'));
config.cloudEnv = 'abort-smoke';

let calls = 0;
global.wx = {
  getFileSystemManager: () => ({}),
  cloud: {
    init() {},
    callFunction() { calls += 1; return new Promise(() => {}); }
  }
};

const { cloudFetch } = require('../src/platform/fetch.weapp.cjs');
(async () => {
  const controller = new AbortController();
  const pending = cloudFetch('/api/sync/status', { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(cloudFetch('/api/sync/status', { signal: alreadyAborted.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
  console.log('cloud fetch abort smoke passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
