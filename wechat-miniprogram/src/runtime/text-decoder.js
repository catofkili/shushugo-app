/*
 * iOS 版微信的小程序环境没有 TextDecoder（2026-09-25 真机首测：
 * `ReferenceError: Can't find variable: TextDecoder`，一打开就「初始化本地库失败」）。
 * vendor/sql-wasm.js 的 emscripten 胶水无条件 `var Za=new TextDecoder`，读每一个 TEXT 列都靠它。
 * 开发者工具的模拟器跑在 Chromium 上、自带 TextDecoder，Node 测试用的又是 npm 版 sql.js，
 * 所以这个缺口在模拟器和 CI 里永远复现不了，只有 iPhone 真机会炸。
 *
 * 只补 sql.js 用到的那一点：utf-8、decode(Uint8Array)。非法字节按 U+FFFD 逐字节替换
 * （SQLite 里的 TEXT 是 sql.js 自己写进去的，正常数据不会走到这一支）。
 * ⚠️ 必须在 require('../vendor/sql-wasm.js') 之前装上——见 sqlite.js 第一行。
 * 判据在 scripts/text-decoder-smoke.mjs：拿出厂词库对照系统自带的 TextDecoder，逐字一致。
 */
function decodeUtf8(input) {
  const bytes = input instanceof Uint8Array ? input
    : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input || []);
  let out = '';
  let units = [];
  const push = (codePoint) => {
    if (codePoint > 0xffff) {
      codePoint -= 0x10000;
      units.push(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
    } else {
      units.push(codePoint);
    }
    // String.fromCharCode.apply 的参数个数有上限，分块拼。
    if (units.length >= 8192) { out += String.fromCharCode.apply(null, units); units = []; }
  };
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i];
    const size = lead < 0x80 ? 1 : lead >= 0xc2 && lead < 0xe0 ? 2 : lead >= 0xe0 && lead < 0xf0 ? 3 : lead >= 0xf0 && lead < 0xf5 ? 4 : 0;
    if (size === 1) { push(lead); i += 1; continue; }
    let codePoint = size === 2 ? lead & 0x1f : size === 3 ? lead & 0x0f : lead & 0x07;
    let valid = size > 0 && i + size <= bytes.length;
    for (let k = 1; valid && k < size; k += 1) {
      const next = bytes[i + k];
      if ((next & 0xc0) !== 0x80) valid = false;
      else codePoint = (codePoint << 6) | (next & 0x3f);
    }
    // 过长编码、代理区、超出 Unicode 范围都算非法。
    if (valid && ((size === 3 && (codePoint < 0x800 || (codePoint >= 0xd800 && codePoint <= 0xdfff)))
      || (size === 4 && (codePoint < 0x10000 || codePoint > 0x10ffff)))) valid = false;
    if (valid) { push(codePoint); i += size; } else { push(0xfffd); i += 1; }
  }
  return out + String.fromCharCode.apply(null, units);
}

function TextDecoderPolyfill(label) {
  const encoding = String(label || 'utf-8').toLowerCase();
  if (encoding !== 'utf-8' && encoding !== 'utf8') throw new RangeError(`TextDecoder 替身只支持 utf-8，收到 ${label}`);
  this.encoding = 'utf-8';
}
TextDecoderPolyfill.prototype.decode = function decode(input) { return decodeUtf8(input); };

if (typeof globalThis.TextDecoder !== 'function') globalThis.TextDecoder = TextDecoderPolyfill;

module.exports = { decodeUtf8, TextDecoderPolyfill };
