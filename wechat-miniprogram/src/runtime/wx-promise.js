// 微信 API 的 Promise 薄封装。所有数据库操作都在当前小程序进程内完成，
// 不会触碰现有 iOS/Chrome 学习页面或其 IndexedDB。
const fileSystem = wx.getFileSystemManager();
const fileMethods = new Set(['readFile', 'writeFile', 'unlink', 'rename', 'access', 'mkdir']);

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

function readFile(filePath) {
  return callWx('readFile', { filePath }).then((result) => {
    if (result && result.data instanceof ArrayBuffer) return new Uint8Array(result.data);
    if (result && result.data instanceof Uint8Array) return result.data;
    throw new Error('微信文件读取结果不是二进制数据');
  });
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

function requestJson(url, options = {}) {
  return callWx('request', {
    url,
    method: options.method || 'GET',
    data: options.data,
    header: options.header || {}
  }).then((result) => {
    if (!result || result.statusCode < 200 || result.statusCode >= 300) {
      let data = result?.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { /* keep the status-only error */ }
      }
      const error = new Error(`接口请求失败（HTTP ${result?.statusCode ?? 'unknown'}）`);
      error.statusCode = result?.statusCode;
      error.data = data;
      error.headers = result?.header || {};
      throw error;
    }
    if (typeof result.data === 'string') {
      try { return JSON.parse(result.data); } catch { throw new Error('接口返回不是合法 JSON'); }
    }
    return result.data;
  });
}

function requestBinary(url, options = {}) {
  return callWx('request', {
    url,
    method: options.method || 'GET',
    data: options.data,
    header: options.header || {},
    responseType: 'arraybuffer',
    timeout: options.timeout
  }).then((result) => {
    if (!result || result.statusCode < 200 || result.statusCode >= 300) {
      let data = result?.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { /* keep the status-only error */ }
      }
      const error = new Error(`接口请求失败（HTTP ${result?.statusCode ?? 'unknown'}）`);
      error.statusCode = result?.statusCode;
      error.data = data;
      error.headers = result?.header || {};
      throw error;
    }
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
  return callWx('mkdir', { dirPath, recursive: true });
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
