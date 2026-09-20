// 小程序 → 云函数 → Cloudflare Worker 的转发层。
// 小程序直接调的域名必须 ICP 备案，Cloudflare 备不了；云函数出海不受这条限制。
// 目标域名只认环境变量 WORKER_ORIGIN，客户端传什么都不看 —— 否则这就是个开放代理。
// 控制台默认给的运行时是 Node 16（没有全局 fetch），下面用 https 补一个够用的；
// 环境变量也可能没配上，所以 WORKER_ORIGIN 有默认值（它不是密钥）。
const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_ORIGIN = 'https://api.shushugo.com';
const ORIGIN = String(process.env.WORKER_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

// 只实现这里用到的子集：method / headers / body(Buffer|string)，响应给 ok / status / headers / text / arrayBuffer。
const fetch = globalThis.fetch || ((url, init = {}) => new Promise((resolve, reject) => {
  // 临时 CDN 是 http://，Worker 是 https://，按协议选模块。
  const request = (String(url).startsWith('http://') ? http : https).request(url, { method: init.method || 'GET', headers: init.headers || {} }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const headers = new Map(Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]));
      resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        headers,
        text: async () => buffer.toString('utf8'),
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      });
    });
  });
  request.on('error', reject);
  if (init.body != null) request.write(init.body);
  request.end();
}));
const FORWARD_HEADERS = new Set([
  'authorization', 'content-type', 'accept',
  'x-sync-format', 'x-sync-protocol-version', 'x-sync-compression', 'x-sync-operation-id',
  'x-sync-device-id', 'x-sync-base-generation', 'x-sync-base-modified'
]);
const RETURN_HEADERS = new Set([
  'content-type', 'x-sync-format', 'x-sync-compression', 'x-sync-generation',
  'x-sync-last-modified', 'x-sync-byte-length', 'retry-after'
]);

const reply = (statusCode, header, extra) => ({ statusCode, header, ...extra });
const fail = (statusCode, detail) => reply(statusCode, { 'content-type': 'application/json' }, { body: JSON.stringify({ detail }) });

exports.main = async (event) => {
  if (!ORIGIN) return fail(500, '云函数没有配置 WORKER_ORIGIN');
  const path = String(event?.path || '');
  if (!path.startsWith('/api/')) return fail(400, '只转发 /api/ 下的路径');

  const headers = {};
  for (const [key, value] of Object.entries(event.headers || {})) {
    const name = key.toLowerCase();
    if (FORWARD_HEADERS.has(name)) headers[name] = String(value);
  }

  let body;
  if (event.bodyIsCdn) {
    // 二进制请求体经 wx.cloud.CDN 中转，这里收到的是临时 CDN 的 URL
    // （实测是 http://vweixinf.tc.qq.com/…，不是 https）。
    if (typeof event.body !== 'string' || !/^https?:\/\/[^/]*\.qq\.com\//.test(event.body)) {
      const preview = typeof event.body === 'string' ? event.body.slice(0, 80) : JSON.stringify(event.body)?.slice(0, 80);
      return fail(400, `二进制请求体不是 CDN 地址（${typeof event.body}: ${preview}）`);
    }
    const upstream = await fetch(event.body);
    if (!upstream.ok) return fail(502, `读取临时 CDN 失败（HTTP ${upstream.status}）`);
    body = Buffer.from(await upstream.arrayBuffer());
  } else if (event.body != null) {
    body = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
    headers['content-type'] ||= 'application/json';
  }

  const response = await fetch(ORIGIN + path, { method: String(event.method || 'GET').toUpperCase(), headers, body });
  const header = {};
  response.headers.forEach((value, key) => { if (RETURN_HEADERS.has(key)) header[key] = value; });

  if (!event.binary || !response.ok) return reply(response.status, header, { body: await response.text() });

  // 云函数返回值也有大小上限：二进制响应放进云存储，客户端按 fileID 拉。
  // 路径按 openid 固定，每次覆盖，不用清理；openid 对别的用户不可知，等于不可猜。
  const { OPENID } = cloud.getWXContext();
  const { fileID } = await cloud.uploadFile({
    cloudPath: `sync/${OPENID}/pull.bin`,
    fileContent: Buffer.from(await response.arrayBuffer())
  });
  return reply(response.status, header, { fileID });
};
