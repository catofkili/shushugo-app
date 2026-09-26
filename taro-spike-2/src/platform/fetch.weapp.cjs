const cloud = require('../../../wechat-miniprogram/src/runtime/cloud');
const { requestBinary, requestJson } = require('../../../wechat-miniprogram/src/runtime/wx-promise');

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function response(status, headers, data, bytes) {
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? {});
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headerValue(headers, String(name)) },
    async json() { return data && typeof data === 'object' ? data : JSON.parse(text); },
    async text() { return text; },
    async arrayBuffer() {
      if (bytes) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const encoded = unescape(encodeURIComponent(text));
      const result = new Uint8Array(encoded.length);
      for (let index = 0; index < encoded.length; index += 1) result[index] = encoded.charCodeAt(index);
      return result.buffer;
    }
  };
}

function failedResponse(error) {
  if (!Number.isFinite(Number(error?.statusCode))) throw error;
  return response(Number(error.statusCode), error.headers || {}, error.data ?? { detail: error.message });
}

function abortError() {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function withAbort(signal, run) {
  if (!signal) return run();
  if (signal.aborted) return Promise.reject(abortError());
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort);
  });
  const request = Promise.resolve().then(() => {
    if (signal.aborted) throw abortError();
    return run();
  });
  return Promise.race([request, aborted]).finally(() => signal.removeEventListener('abort', onAbort));
}

if (typeof globalThis.AbortController !== 'function') {
  globalThis.AbortController = class AbortController {
    constructor() {
      const listeners = new Set();
      this.signal = {
        aborted: false,
        addEventListener(type, listener) { if (type === 'abort') listeners.add(listener); },
        removeEventListener(type, listener) { if (type === 'abort') listeners.delete(listener); }
      };
      this.listeners = listeners;
    }
    abort() {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.listeners.forEach((listener) => listener());
    }
  };
}

async function cloudFetch(input, init = {}) {
  if (init.signal?.aborted) throw abortError();
  if (!cloud.enabled()) throw new Error('小程序云开发尚未就绪，拒绝直接请求 Worker 域名');
  const url = typeof input === 'string' ? input : input.url;
  const headers = init.headers || {};
  const options = {
    method: init.method || 'GET',
    header: headers,
    data: init.body,
    timeout: 60_000
  };

  if (String(headerValue(headers, 'accept') || '').includes('application/octet-stream')) {
    try {
      const result = await withAbort(init.signal, () => requestBinary(url, options));
      return response(200, result.header, null, result.bytes);
    } catch (error) {
      return failedResponse(error);
    }
  }

  try {
    return response(200, { 'content-type': 'application/json' }, await withAbort(init.signal, () => requestJson(url, options)));
  } catch (error) {
    return failedResponse(error);
  }
}

if (typeof wx !== 'undefined') globalThis.fetch = cloudFetch;

module.exports = { cloudFetch, fetch: cloudFetch };
