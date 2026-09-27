if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ target, contentRect: { width: target.clientWidth, height: target.clientHeight } }]); }
    unobserve() {}
    disconnect() {}
  };
}

const objectUrls = new Map();
let nextObjectUrl = 0;
if (typeof globalThis.Blob !== 'function') {
  globalThis.Blob = class WeappBlob {
    constructor(parts = [], options = {}) {
      this.parts = parts;
      this.type = String(options.type || '').toLowerCase();
      this.size = parts.reduce((size, part) => size + (typeof part === 'string'
        ? new globalThis.TextEncoder().encode(part).byteLength
        : part instanceof ArrayBuffer ? part.byteLength
          : ArrayBuffer.isView(part) ? part.byteLength : 0), 0);
    }
    async arrayBuffer() {
      const chunks = this.parts.map((part) => typeof part === 'string' ? new globalThis.TextEncoder().encode(part)
        : part instanceof ArrayBuffer ? new Uint8Array(part)
          : ArrayBuffer.isView(part) ? new Uint8Array(part.buffer, part.byteOffset, part.byteLength)
            : new Uint8Array());
      const bytes = new Uint8Array(this.size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes.buffer;
    }
  };
}
if (typeof globalThis.FileReader !== 'function') {
  globalThis.FileReader = class WeappFileReader {
    result = null;
    error = null;
    onload = null;
    onerror = null;
    onloadend = null;
    readAsDataURL(file) {
      const filePath = file?.path || file?.tempFilePath || file?.filePath;
      if (!filePath) {
        this.error = new Error('微信没有提供可读取的临时文件路径');
        this.onerror?.({ target: this });
        this.onloadend?.({ target: this });
        return;
      }
      wx.getFileSystemManager().readFile({ filePath, encoding: 'base64',
        success: ({ data }) => {
          this.result = `data:${file.type || 'application/octet-stream'};base64,${data}`;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        },
        fail: (error) => {
          this.error = error;
          this.onerror?.({ target: this });
          this.onloadend?.({ target: this });
        }
      });
    }
  };
}

const createObjectURL = (blob) => {
  // 分享图（share-canvas.weapp.ts）的 Blob 已经是写好的本地文件，直接给路径；其余（备份导出）登记成 wxblob://
  if (blob?.__wxDataUrl) return blob.__wxDataUrl;
  const url = `wxblob://${++nextObjectUrl}`;
  objectUrls.set(url, blob);
  return url;
};
const revokeObjectURL = (url) => objectUrls.delete(String(url));

const createDownloadLink = () => {
  let href = '';
  let fileName = '';
  return {
    set href(value) { href = String(value); },
    get href() { return href; },
    set download(value) { fileName = String(value); },
    get download() { return fileName; },
    click() {
      const blob = objectUrls.get(href);
      const dataUrl = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(href);
      const payload = blob?.arrayBuffer ? blob.arrayBuffer()
        : dataUrl?.[2] ? Promise.resolve(wx.base64ToArrayBuffer(dataUrl[3]))
          : dataUrl ? Promise.resolve(new globalThis.TextEncoder().encode(decodeURIComponent(dataUrl[3])).buffer)
            : Promise.reject(new Error('导出文件内容不可用'));
      Promise.resolve(payload).then((data) => {
        const safeName = (fileName || 'shushugo-export.bin').replace(/[\\/\0]/g, '_');
        const filePath = `${wx.env.USER_DATA_PATH}/${safeName}`;
        wx.getFileSystemManager().writeFile({ filePath, data,
          success: () => {
            if (typeof wx.shareFileMessage === 'function') {
              wx.shareFileMessage({ filePath, fileName: safeName, fail: (error) => console.warn('[export]', error) });
            } else if (typeof wx.openDocument === 'function') {
              wx.openDocument({ filePath, showMenu: true, fail: (error) => console.warn('[export]', error) });
            }
          },
          fail: (error) => console.error('[export]', error)
        });
      }).catch((error) => console.error('[export]', error));
    }
  };
};
module.exports = { createObjectURL, revokeObjectURL, createDownloadLink };
