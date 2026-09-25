const noop = () => Promise.resolve(undefined);
const api = new Proxy(noop, {
  get: (_target, property) => property === 'then' ? undefined : api
});
const capacitor = { isNativePlatform: () => false, getPlatform: () => 'weapp' };

module.exports = new Proxy({}, {
  get: (_target, property) => property === '__esModule' ? false : property === 'Capacitor' ? capacitor : api
});
