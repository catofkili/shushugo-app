// 微信 API 的 Promise 薄封装。所有数据库操作都在当前小程序进程内完成，
// 不会触碰现有 iOS/Chrome 学习页面或其 IndexedDB。
const cloud = require('./cloud');
const fileSystem = wx.getFileSystemManager();
const fileMethods = new Set(['readFile', 'writeFile', 'unlink', 'rename', 'access', 'mkdir', 'stat']);

function callWx(method, options) {
  const target = fileMethods.has(method) ? fileSystem : wx;
  const api = target[method];
  if (typeof api !== 'function') throw new Error(`微信 API 不可用：${method}`);
  return new Promise((resolve, reject) => {
    api.call(target, {
      ...options,
      success: resolve,
      fail: reject
    });
  });
}

// 开发者工具的 readFile 内部走 base64，一次读 11 MB 的词库会在 atob 上炸
// （InvalidCharacterError），真机没这个问题。分块读两边都能过：实测 2 MB 一块 OK。
// position/length 要基础库 2.10.0。
const READ_CHUNK_BYTES = 2 * 1024 * 1024;
// 开发者工具里 readFile 给的 ArrayBuffer 来自另一个 JS 上下文，instanceof 认不出；
// 只看有没有 byteLength。
function toBytes(result) {
  const data = result?.data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof data.byteLength === 'number') return new Uint8Array(data);
  throw new Error('微信文件读取结果不是二进制数据');
}

async function readFile(filePath) {
  const size = Number((await callWx('stat', { path: filePath }))?.stats?.size);
  if (!Number.isFinite(size) || size <= READ_CHUNK_BYTES) return toBytes(await callWx('readFile', { filePath }));
  const out = new Uint8Array(size);
  for (let position = 0; position < size; position += READ_CHUNK_BYTES) {
    const chunk = toBytes(await callWx('readFile', { filePath, position, length: Math.min(READ_CHUNK_BYTES, size - position) }));
    out.set(chunk, position);
  }
  return out;
}

function writeFile(filePath, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return callWx('writeFile', {
    filePath,
    data: bytes.buffer
  });
}

function readCompressedFile(filePath, compressionAlgorithm = 'gzip') {
  if (typeof fileSystem.readCompressedFile !== 'function') {
    return Promise.reject(new Error('当前微信基础库不支持 gzip 解压，请升级微信后重试'));
  }
  return new Promise((resolve, reject) => {
    fileSystem.readCompressedFile({
      filePath,
      compressionAlgorithm,
      success: (result) => {
        if (result?.data instanceof ArrayBuffer) return resolve(new Uint8Array(result.data));
        if (result?.data instanceof Uint8Array) return resolve(result.data);
        reject(new Error('微信 gzip 解压结果不是二进制数据'));
      },
      fail: reject
    });
  });
}

async function downloadFile(url, options = {}) {
  if (cloud.isCloudFile(url)) return cloud.downloadCloudFile(url);
  const retries = Math.max(1, Number(options.retries ?? 3));
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const result = await new Promise((resolve, reject) => {
        const task = wx.downloadFile({ url, success: resolve, fail: reject });
        task?.onProgressUpdate?.((progress) => options.onProgress?.(progress));
      });
      if (!result || result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(`词库下载失败（HTTP ${result?.statusCode ?? 'unknown'}）`);
      }
      return result.tempFilePath;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastError || new Error('词库下载失败');
}

function httpError(result) {
  let data = result?.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { /* keep the status-only error */ }
  }
  // 把服务端的 detail 带进消息：只写「HTTP 400」的话页面上什么都看不出来。
  const detail = data && typeof data === 'object' ? (data.detail || data.message || data.code) : '';
  const error = new Error(`接口请求失败（HTTP ${result?.statusCode ?? 'unknown'}）${detail ? `：${detail}` : ''}`);
  error.statusCode = result?.statusCode;
  error.data = data;
  error.headers = result?.header || {};
  return error;
}

function isBinaryBody(data) {
  return data instanceof ArrayBuffer || ArrayBuffer.isView(data);
}

// 云开发模式：把 wx.request 的参数原样交给云函数 api。只送路径不送域名 ——
// Worker 地址由云函数自己的环境变量决定，客户端说什么都不算。
async function cloudRequest(url, options, binary) {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  let body = options.data;
  if (isBinaryBody(body)) {
    const bytes = body instanceof ArrayBuffer ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    body = cloud.cdnBody(bytes);
    if (!body) throw new Error('当前微信基础库不支持 wx.cloud.CDN，无法上传快照');
  }
  const result = await cloud.callApi({
    path,
    method: options.method || 'GET',
    headers: options.header || {},
    body,
    bodyIsCdn: isBinaryBody(options.data),
    binary
  });
  return { statusCode: result.statusCode, header: result.header || {}, data: result.body, fileID: result.fileID };
}

async function readCloudJson(fileID) {
  const tempPath = await cloud.downloadCloudFile(fileID);
  const bytes = await readFile(tempPath);
  const text = typeof TextDecoder === 'function'
    ? new TextDecoder().decode(bytes)
    : decodeURIComponent(Array.from(bytes, (b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  return JSON.parse(text);
}

function requestJson(url, options = {}) {
  if (cloud.isCloudFile(url)) return readCloudJson(url);
  const transport = cloud.enabled() ? cloudRequest(url, options, false) : callWx('request', {
    url,
    method: options.method || 'GET',
    data: options.data,
    header: options.header || {}
  });
  return transport.then((result) => {
    if (!result || result.statusCode < 200 || result.statusCode >= 300) throw httpError(result);
    if (typeof result.data === 'string') {
      try { return JSON.parse(result.data); } catch { throw new Error('接口返回不是合法 JSON'); }
    }
    return result.data;
  });
}

async function requestBinary(url, options = {}) {
  if (cloud.enabled()) {
    // 云函数返回值也有大小上限，二进制响应由云函数放进云存储，这里再拉下来。
    const result = await cloudRequest(url, options, true);
    if (result.statusCode < 200 || result.statusCode >= 300) throw httpError(result);
    if (!result.fileID) throw new Error('云函数没有返回二进制文件');
    const bytes = await readFile(await cloud.downloadCloudFile(result.fileID));
    return { bytes, header: result.header };
  }
  return callWx('request', {
    url,
    method: options.method || 'GET',
    data: options.data,
    header: options.header || {},
    responseType: 'arraybuffer',
    timeout: options.timeout
  }).then((result) => {
    if (!result || result.statusCode < 200 || result.statusCode >= 300) throw httpError(result);
    const data = result.data instanceof ArrayBuffer
      ? new Uint8Array(result.data)
      : result.data instanceof Uint8Array ? result.data : null;
    if (!data) throw new Error('接口返回不是二进制数据');
    return { bytes: data, header: result.header || {} };
  });
}

function removeFile(filePath) {
  return callWx('unlink', { filePath }).catch((error) => {
    // 文件不存在是幂等成功；其他错误继续抛出。
    if (error?.errMsg?.includes('no such file') || error?.errMsg?.includes('not exist')) return undefined;
    throw error;
  });
}

function renameFile(oldPath, newPath) {
  return callWx('rename', { oldPath, newPath });
}

function makeDirectory(dirPath) {
  // 目录已存在是幂等成功：开发者工具里 recursive mkdir 撞到已有目录会 fail（真机不会）。
  return callWx('mkdir', { dirPath, recursive: true }).catch((error) => {
    if (/already exists|file exists/i.test(error?.errMsg || '')) return undefined;
    throw error;
  });
}

function fileExists(filePath) {
  return callWx('access', { path: filePath }).then(() => true).catch(() => false);
}

module.exports = {
  callWx,
  downloadFile,
  fileExists,
  makeDirectory,
  readFile,
  readCompressedFile,
  removeFile,
  renameFile,
  requestBinary,
  requestJson,
  writeFile
};
