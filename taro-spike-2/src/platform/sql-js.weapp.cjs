require('../../../wechat-miniprogram/src/runtime/text-decoder.js');
const initVendorSqlJs = require('../../../wechat-miniprogram/src/vendor/sql-wasm.js');

const WASM_PATH = '/core/sql-wasm.wasm.br';

function loadCorePackage() {
  if (typeof __non_webpack_require__ !== 'function' || typeof __non_webpack_require__.async !== 'function') {
    return Promise.reject(new Error('分包异步化 require.async 不可用'));
  }
  return __non_webpack_require__.async('./core/index.js');
}

module.exports = async (options = {}) => {
  await loadCorePackage();

  let rejectWasm;
  const wasmFailure = new Promise((_, reject) => { rejectWasm = reject; });
  const database = initVendorSqlJs({
    ...options,
    locateFile: () => WASM_PATH,
    instantiateWasm(imports, done) {
      const wasm = globalThis.WXWebAssembly;
      if (!wasm?.instantiate) throw new Error('当前环境没有 WXWebAssembly.instantiate');
      wasm.instantiate(WASM_PATH, imports).then((result) => {
        const instance = result?.instance ?? result;
        if (!instance?.exports) throw new Error('WXWebAssembly 未返回有效 WebAssembly.Instance');
        done(instance, result?.module);
      }).catch((error) => {
        console.error('[taro/sql.js] WASM 初始化失败', error);
        rejectWasm(error);
      });
      return {};
    }
  });

  return Promise.race([database, wasmFailure]);
};
