module.exports = new Proxy({}, {
  get: (_target, property) => property === '__esModule' ? false : () => {
    throw new Error(`node:fs.${String(property)} is unavailable in WeChat`);
  }
});
