/*
 * 出厂内容 JSON 的懒代理。
 *
 * ⚠️ 网页那几个模块在**模块初始化时**就取一层属性并存进常量：
 *   const kanjiVariants = payload.japanese_to_simplified ?? {}   (models/word-card)
 *   const readings = payload.readings                            (kanji-char-cards)
 *   const points = data.points                                   (grammar-key-points)
 * 而数据要等分包 require.async 回来。所以这里**永远返回代理、绝不返回 undefined** ——
 * 返回 undefined 的话那个 `?? {}` 会把空对象永久固定下来，表加载完了也永远查不到东西
 * （现象：卡面不显示简繁对照、语法抓手永远为空，而且没有任何报错）。
 * 真正的键在每次访问时才去 content-store 查。
 */
const stores = require('../shared/content-store');

const resolve = (name, path) => {
  let value = stores[name];
  for (const key of path) value = value == null ? undefined : value[key];
  return value;
};

const proxy = (name, path) => new Proxy({}, {
  get(_target, key) {
    if (key === '__esModule') return false;
    if (typeof key === 'symbol') return undefined;
    if (key === 'default' && path.length === 0) return proxy(name, path);
    const value = resolve(name, [...path, key]);
    // 还没加载 → 继续给一层代理，让调用方存下来的引用保持活的。
    if (value === undefined) return proxy(name, [...path, key]);
    return value && typeof value === 'object' ? proxy(name, [...path, key]) : value;
  },
  has(_target, key) {
    const parent = resolve(name, path);
    return Boolean(parent) && typeof parent === 'object' && key in parent;
  },
  ownKeys() {
    const parent = resolve(name, path);
    return parent && typeof parent === 'object' ? Reflect.ownKeys(parent) : [];
  },
  getOwnPropertyDescriptor(_target, key) {
    const parent = resolve(name, path);
    if (!parent || typeof parent !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(parent, key);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  }
});

module.exports = (name) => proxy(name, []);
