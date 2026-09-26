// 云开发传输层。小程序直接调的域名必须 ICP 备案，而 Cloudflare 备不了；
// 云函数 / 云存储不需要业务域名，所以填了 config.cloudEnv 之后：
//   - http(s) 接口请求 → 云函数 `api` 转发到 Worker（Worker 地址只在云函数的环境变量里）
//   - cloud:// 开头的地址 → 云存储（种子库、manifest、音频）
// 没填时一切照旧走 wx.request / wx.downloadFile，纯离线也不受影响。
const config = require('../config');

let initialized = false;

function enabled() {
  return Boolean(config.cloudEnv) && typeof wx !== 'undefined' && Boolean(wx.cloud);
}

function ensureInit() {
  if (initialized) return;
  wx.cloud.init({ env: config.cloudEnv, traceUser: false });
  initialized = true;
}

function isCloudFile(url) {
  return typeof url === 'string' && url.startsWith('cloud://');
}

async function callApi(payload) {
  ensureInit();
  const response = await wx.cloud.callFunction({ name: 'api', data: payload });
  const result = response?.result;
  if (!result || typeof result.statusCode !== 'number') throw new Error('云函数 api 没有返回状态码');
  return result;
}

async function downloadCloudFile(fileID, options = {}) {
  ensureInit();
  try {
    // cloud.downloadFile returns only a Promise, so it cannot report byte progress.
    // A short-lived URL lets wx.downloadFile expose the normal progress task instead.
    const response = await wx.cloud.getTempFileURL({ fileList: [fileID] });
    const url = response?.fileList?.[0]?.tempFileURL;
    if (!url) throw new Error('云存储没有返回临时下载地址');
    const result = await new Promise((resolve, reject) => {
      const task = wx.downloadFile({ url, success: resolve, fail: reject });
      task?.onProgressUpdate?.((progress) => options.onProgress?.(progress));
    });
    if (!result?.tempFilePath) throw new Error('云存储下载没有返回临时文件');
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`云存储下载失败（HTTP ${result.statusCode}）`);
    }
    return result.tempFilePath;
  } catch (progressError) {
    // Preserve the SDK's direct path on older base libraries or when URL signing is unavailable.
    console.warn('[cloud] 带进度的下载不可用，回退云存储 SDK', progressError);
    const result = await wx.cloud.downloadFile({ fileID });
    if (!result?.tempFilePath) throw new Error('云存储下载没有返回临时文件');
    return result.tempFilePath;
  }
}

// 云函数入参上限 5 MB；二进制请求体（快照）交给临时 CDN，云函数收到的是一个 URL。
function cdnBody(bytes) {
  return typeof wx.cloud.CDN === 'function' ? wx.cloud.CDN(bytes) : null;
}

module.exports = { callApi, cdnBody, downloadCloudFile, enabled, isCloudFile };
