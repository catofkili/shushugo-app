import { useCallback } from 'react';
import { getCurrentInstance } from '@tarojs/taro';
import type { TaroElement } from '@tarojs/runtime';

/*
 * 小程序里网页的 createPortal(弹层, document.body) 渲染不出来。
 * Taro 的 React 插件把 react-dom 换成了 @tarojs/react，document.body 是 Taro 模拟的节点，
 * 不属于任何页面——微信只渲染页面根节点下面的内容，所以首次设定、收藏夹选择、辨析气泡、
 * 分享面板这类弹层整个看不见，也不报错。（W1 修查词弹窗时撞上过，当时只换了那一个组件。）
 *
 * 所以按页面登记「带主题 class 的最外层节点」，小程序版 createPortal（react-dom.weapp.ts）
 * 把弹层挂进去。三件事同时成立：
 *  - 跳出带 transform 的祖先（单词卡片滑动时就有），position: fixed 才以屏幕为准；
 *  - React 上下文照常（真 portal，不是另开一棵树）；
 *  - 拿得到 .theme-* / .skin-* ——主题规则全是「.theme-light 里的 xxx」，挂在外壳外面就退回老配色。
 */
const hosts = new Map<string, TaroElement>();
const currentPath = () => getCurrentInstance().router?.$taroPath ?? '';

export const portalHostForCurrentPage = (): TaroElement | null => hosts.get(currentPath()) ?? null;

/** 页面外壳（WeappPage）在带主题 class 的最外层 View 上挂 `ref={usePortalHost()}`。 */
export const usePortalHost = () => {
  // 页面渲染时 Current.router 就是这一页；之后弹层创建时再按当时的当前页去查。
  const path = currentPath();
  return useCallback((element: TaroElement | null) => {
    if (element) hosts.set(path, element);
    else if (hosts.get(path) && !element) hosts.delete(path);
  }, [path]);
};
