require('../../../wechat-miniprogram/src/runtime/text-decoder.js');
const initVendorSqlJs = require('../../../wechat-miniprogram/src/vendor/sql-wasm.js');

const WASM_PATH = '/assets/sql-wasm.wasm';

function instantiateWasm(imports, done) {
  const wasm = globalThis.WXWebAssembly;
  if (!wasm?.instantiate) throw new Error('当前环境没有 WXWebAssembly.instantiate');
  wasm.instantiate(WASM_PATH, imports).then((result) => {
    const instance = result?.instance ?? result;
    if (!instance?.exports) throw new Error('WXWebAssembly 未返回有效 WebAssembly.Instance');
    done(instance, result?.module);
  }).catch((error) => console.error('[taro/sql.js] WASM 初始化失败', error));
  return {};
}

module.exports = (options = {}) => initVendorSqlJs({
  ...options,
  locateFile: () => WASM_PATH,
  instantiateWasm
});
