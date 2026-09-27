// ProvidePlugin 把网页源码里的裸 localStorage 指到这里（config/index.js 的 spike-local-storage）。
// ⚠️ 这个模块除了 polyfill 不许有别的依赖。原来指的是 app-polyfills.weapp.ts 的导出，而 app-polyfills 引了
// fetch.weapp.cjs → payment-auth / preferences 又用 localStorage → 转回 app-polyfills：循环依赖里拿到的是还没赋值的
// 导出，永久是 undefined。真机上「使用微信登录」报「微信本地偏好存储尚未初始化」，云请求静默不带登录令牌（2026-09-26）。
require('../../../wechat-miniprogram/scripts/shared/polyfill.js');

module.exports = globalThis.localStorage;
