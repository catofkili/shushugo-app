require('../../../wechat-miniprogram/src/runtime/text-decoder.js');

const Directory = { Data: 'DATA', Library: 'LIBRARY', Documents: 'DOCUMENTS', Cache: 'CACHE' };
const Encoding = { UTF8: 'utf8' };

const clean = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const rootPath = () => wx.env.USER_DATA_PATH;
const fullPath = (path, directory) => {
  const suffix = clean(path);
  if (!directory) return suffix;
  const root = String(rootPath()).replace(/\/+$/, '');
  return suffix ? `${root}/${suffix}` : root;
};
const manager = () => wx.getFileSystemManager();
const call = (method, options) => new Promise((resolve, reject) => {
  manager()[method]({ ...options, success: resolve, fail: (cause) => {
    const message = String(cause?.errMsg || cause?.message || cause || 'File operation failed');
    const error = new Error(/no such file|not exist|not found/i.test(message) ? 'File does not exist.' : message);
    if (error.message === 'File does not exist.') error.code = 'ENOENT';
    error.errMsg = message;
    reject(error);
  } });
});
const mkdir = async (path) => {
  try { await call('mkdir', { dirPath: path, recursive: true }); }
  catch (error) {
    if (!/already exists|file exists/i.test(String(error?.errMsg || error?.message))) throw error;
  }
};
const toBase64 = (bytes) => wx.arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const fromBase64 = (value) => wx.base64ToArrayBuffer(value);

const Filesystem = {
  async writeFile({ path, data, directory, encoding, recursive = false }) {
    const target = fullPath(path, directory);
    const parent = target.slice(0, target.lastIndexOf('/'));
    if (recursive && parent) await mkdir(parent);
    let content = data;
    if (encoding !== Encoding.UTF8) {
      if (typeof data === 'string') content = fromBase64(data);
      else if (data instanceof Uint8Array) content = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      else if (data instanceof ArrayBuffer) content = data;
      else throw new TypeError('Filesystem data must be base64, Uint8Array, or ArrayBuffer');
    }
    await call('writeFile', { filePath: target, data: content, ...(encoding ? { encoding } : {}) });
    return { uri: target };
  },
  async readFile({ path, directory, encoding }) {
    const filePath = fullPath(path, directory);
    // storage.ts 在小程序里读整库传 encoding: 'binary'（它自己的约定，见 FILE_BINARY 的注释）：
    // 直接返回字节，不转 base64。⚠️ 这个值不能透传给 wx——wx 的 readFile 把 'binary' 当成
    // 「返回二进制字符串」，那又回到了在 JS 里逐字节拼串的老路。
    const binary = encoding === 'binary';
    const result = await call('readFile', { filePath, ...(encoding && !binary ? { encoding } : {}) });
    if (encoding === Encoding.UTF8) return { data: typeof result.data === 'string' ? result.data : new TextDecoder().decode(result.data) };
    const data = result.data instanceof ArrayBuffer ? new Uint8Array(result.data)
      : ArrayBuffer.isView(result.data) ? new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
        : new Uint8Array(result.data);
    return { data: binary ? data : toBase64(data) };
  },
  async rename({ from, to, directory, toDirectory }) {
    const fromPath = fullPath(from, directory);
    const toPath = fullPath(to, toDirectory ?? directory);
    await call('rename', { oldPath: fromPath, newPath: toPath });
    return { uri: toPath };
  },
  async stat({ path, directory }) {
    const filePath = fullPath(path, directory);
    const { stats } = await call('stat', { path: filePath });
    const type = stats?.isDirectory?.() ? 'directory' : 'file';
    return { type, size: Number(stats?.size || 0), ctime: Number(stats?.ctime || 0), mtime: Number(stats?.mtime || 0), uri: filePath };
  },
  async deleteFile({ path, directory }) {
    await call('unlink', { filePath: fullPath(path, directory) });
  },
  async readdir({ path, directory }) {
    const dirPath = fullPath(path, directory) || rootPath();
    const { files } = await call('readdir', { dirPath });
    const entries = await Promise.all(files.map(async (name) => {
      const itemPath = `${dirPath}/${name}`;
      const { stats } = await call('stat', { path: itemPath });
      return { name, type: stats?.isDirectory?.() ? 'directory' : 'file', size: Number(stats?.size || 0), mtime: Number(stats?.mtime || 0), uri: itemPath };
    }));
    return { files: entries };
  }
};

module.exports = { Directory, Encoding, Filesystem };
