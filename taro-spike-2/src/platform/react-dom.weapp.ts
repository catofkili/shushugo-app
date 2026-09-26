import type { ReactNode } from 'react';
import * as TaroReact from '@tarojs/react';
import { portalHostForCurrentPage } from './portal-host.weapp';

/*
 * 网页源码 import 的 'react-dom' 在小程序里指向这里（config/index.js 的模块替换）。
 * 其余全部照用 @tarojs/react，只换 createPortal：弹层挂进当前页面的外壳节点，
 * 原因见 portal-host.weapp.ts。外壳还没登记（页面外壳之外渲染的东西）时退回原地渲染。
 * ⚠️ 这里只能 import '@tarojs/react'，不能 import 'react-dom'——会被替换回自己。
 */
export * from '@tarojs/react';
export default TaroReact;

export const createPortal = (children: ReactNode, _container?: unknown, key?: string | null) => {
  const host = portalHostForCurrentPage();
  return host ? TaroReact.createPortal(children, host as never, key ?? undefined) : children;
};
