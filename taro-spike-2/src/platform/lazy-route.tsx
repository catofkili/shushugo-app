import { lazy, Suspense, type ComponentType } from 'react';

/**
 * 标签页的界面代码按需加载（微信分包异步化）：四个标签页的 import() 都写同一个 webpackChunkName「lazy/tabs」，
 * webpack 把它们合成一个异步块、放进 lazy 分包，共用代码只有一份；加载走 config/index.js 的 WxRequireAsyncChunkLoading。
 * 主包里只剩外壳（WeappPage）和数据层。
 */
export const lazyRoute = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ComponentType => {
  const Lazy = lazy(() => load().then((module) => ({ default: module[name] })));
  return () => <Suspense fallback={null}><Lazy /></Suspense>;
};
