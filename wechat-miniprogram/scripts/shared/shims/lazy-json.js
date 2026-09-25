/*
 * 出厂内容 JSON 的懒代理。
 *
 * ⚠️ 网页那几个模块在**模块初始化时**就取一层属性并存进常量：
 *   const kanjiVariants = payload.japanese_to_simplified ?? {}   (models/word-card)
 *   const readings = payload.readings                            (kanji-char-cards)
 *   const points = data.points                                   (grammar-key-points)
 * 而数据要等分包 require.async 回来。所以数据未加载时必须返回代理，不能让那个 `?? {}`
 * 把空对象永久固定下来；但数据已加载后，缺失键必须返回 undefined，否则代理参与字符串
 * 转换时会因没有可调用的 valueOf / toString 抛错。
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
    // content-store 用 null 表示未加载：此时给代理保住早期引用；加载后缺失的键必须是 undefined，不能让代理参与字符串转换。
    if (value === undefined) return stores[name] == null ? proxy(name, [...path, key]) : undefined;
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
