// 出厂内容 JSON 的懒代理：网页在模块初始化时就取一层属性（`payload.readings`、`data.points`），
// 而数据要等分包 require.async 回来。第一层返回一个再懒一层的代理，真正的键在用到时才查
// content-store；灌入前查不到就是 undefined（调用方都有 `?? {}` / `?? char` 兜底）。
const stores = require('../shared/content-store');
const level2 = (name, section) => new Proxy({}, {
  get(_t, key) {
    if (key === '__esModule') return false;
    const root = stores[name];
    const table = root ? root[section] : undefined;
    return table ? table[key] : undefined;
  },
  has(_t, key) { const root = stores[name]; return Boolean(root && root[section] && key in root[section]); },
  ownKeys() { const root = stores[name]; return root && root[section] ? Reflect.ownKeys(root[section]) : []; },
  getOwnPropertyDescriptor(_t, key) { const root = stores[name]; return root && root[section] ? Object.getOwnPropertyDescriptor(root[section], key) : undefined; }
});
module.exports = (name) => new Proxy({}, {
  get(_t, section) {
    if (section === '__esModule') return false;
    if (section === 'default') return module.exports(name);
    if (typeof section === 'symbol') return undefined;
    const root = stores[name];
    const value = root ? root[section] : undefined;
    return value && typeof value === 'object' ? level2(name, section) : value;
  }
});
