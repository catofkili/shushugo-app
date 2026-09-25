const noop = () => Promise.resolve(undefined);
const plugin = new Proxy(noop, {
  get: (_target, property) => property === 'then' ? undefined : plugin
});

const Capacitor = {
  getPlatform: () => 'wechat',
  isNativePlatform: () => false,
  isPluginAvailable: () => false
};

module.exports = {
  Capacitor,
  registerPlugin: () => plugin
};
