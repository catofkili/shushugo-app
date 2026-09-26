module.exports = {
  // dynamic-import-node: false —— 让 import() 留给 webpack 生成异步代码块（config/index.js 的 WxRequireAsyncChunkLoading 用 require.async 加载）。
  presets: [['taro', { framework: 'react', ts: true, compiler: 'webpack5', 'dynamic-import-node': false }]]
};
