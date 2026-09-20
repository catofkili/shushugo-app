// 云开发传输层：用假的 wx.cloud / wx-server-sdk / fetch 走一遍客户端和云函数两端。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const calls = [];
const files = { 'cloud://env.x/seed/nihongo.db': Buffer.from('{"version":"v9","databaseUrl":"cloud://env.x/seed/nihongo.db"}') };
const fs = { tmp: {} };

global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getFileSystemManager: () => ({
    stat: ({ path: p, success }) => success({ stats: { size: fs.tmp[p].length } }),
    readFile: ({ filePath, success }) => success({ data: new Uint8Array(fs.tmp[filePath]).buffer })
  }),
  cloud: {
    init: (options) => calls.push(['init', options]),
    CDN: (bytes) => ({ cdn: bytes.byteLength }),
    callFunction: async ({ name, data }) => {
      calls.push([name, data]);
      if (data.binary) return { result: { statusCode: 200, header: { 'x-sync-compression': 'gzip' }, fileID: 'cloud://env.x/sync/o/pull.bin' } };
      return { result: { statusCode: 200, header: {}, body: JSON.stringify({ available: true, path: data.path }) } };
    },
    downloadFile: async ({ fileID }) => {
      const tempFilePath = `/tmp/${Object.keys(fs.tmp).length}`;
      fs.tmp[tempFilePath] = files[fileID] ?? Buffer.from('binary-body');
      return { tempFilePath };
    }
  }
};

const config = require(path.join(root, 'src/config.js'));
config.cloudEnv = 'env-x';
const { requestJson, requestBinary, downloadFile } = require(path.join(root, 'src/runtime/wx-promise.js'));

// 1. JSON 请求只送路径，不送域名；域名由云函数说了算。
const status = await requestJson('https://whatever.example/api/sync/status', { header: { authorization: 'Bearer t' } });
assert.equal(status.path, '/api/sync/status');
assert.equal(calls.at(-1)[1].path, '/api/sync/status');
assert.equal(calls.at(-1)[1].headers.authorization, 'Bearer t');
assert.equal(calls[0][0], 'init');

// 2. 二进制请求体走 wx.cloud.CDN，云函数收到的是标记而不是原始字节。
await requestJson('https://x/api/sync/push', { method: 'POST', data: new Uint8Array(3000).buffer, header: {} });
assert.deepEqual(calls.at(-1)[1].body, { cdn: 3000 });
assert.equal(calls.at(-1)[1].bodyIsCdn, true);

// 3. 二进制响应按 fileID 从云存储拉回来，响应头原样带回。
const pulled = await requestBinary('https://x/api/sync/pull', { header: {} });
assert.equal(Buffer.from(pulled.bytes).toString(), 'binary-body');
assert.equal(pulled.header['x-sync-compression'], 'gzip');

// 4. cloud:// 地址直接走云存储：种子库下载和 manifest 读取。
assert.ok((await downloadFile('cloud://env.x/seed/nihongo.db')).startsWith('/tmp/'));
assert.equal((await requestJson('cloud://env.x/seed/nihongo.db')).version, 'v9');

// 5. 云函数：只转发到 WORKER_ORIGIN 下的 /api/ 路径，客户端给的域名不看。
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'wx-server-sdk') {
    return { init() {}, DYNAMIC_CURRENT_ENV: 'x', getWXContext: () => ({ OPENID: 'o1' }), uploadFile: async ({ cloudPath }) => ({ fileID: `cloud://x/${cloudPath}` }) };
  }
  return originalLoad.call(this, request, ...rest);
};
process.env.WORKER_ORIGIN = 'https://worker.example/';
const fetched = [];
global.fetch = async (url, init) => {
  fetched.push([url, init]);
  if (url === 'http://vweixinf.tc.qq.com/blob') return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  const headers = new Map([['x-sync-generation', '7'], ['set-cookie', 'nope']]);
  return { ok: true, status: 200, headers, text: async () => '{"ok":true}', arrayBuffer: async () => new Uint8Array([9]).buffer };
};
const { main } = require(path.join(root, 'cloudfunctions/api/index.js'));
assert.equal((await main({ path: '/other' })).statusCode, 400);
const pushed = await main({ path: '/api/sync/push', method: 'POST', headers: { Authorization: 'Bearer t', 'x-evil': '1', 'x-sync-compression': 'gzip' }, body: 'http://vweixinf.tc.qq.com/blob', bodyIsCdn: true });
assert.equal(pushed.statusCode, 200);
assert.equal(fetched.at(-1)[0], 'https://worker.example/api/sync/push');
assert.equal(fetched.at(-1)[1].headers.authorization, 'Bearer t');
assert.equal(fetched.at(-1)[1].headers['x-evil'], undefined);
assert.deepEqual([...fetched.at(-1)[1].body], [1, 2, 3]);
assert.equal(pushed.header['set-cookie'], undefined);
const pull = await main({ path: '/api/sync/pull', binary: true, headers: {} });
assert.equal(pull.fileID, 'cloud://x/sync/o1/pull.bin');
assert.equal(pull.header['x-sync-generation'], '7');
assert.equal((await main({ path: '/api/x', bodyIsCdn: true, body: 'https://evil.example/blob' })).statusCode, 400);

console.log(JSON.stringify({ ok: true, calls: calls.length, fetched: fetched.length }));
