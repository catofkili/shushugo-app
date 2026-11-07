import { createElement, lazy, type ComponentProps, type ComponentType } from "react";

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let loaded: { default: T } | undefined;
  let pending: Promise<{ default: T }> | undefined;
  const preload = (): Promise<{ default: T }> => pending ??= load().then((module) => (loaded = module), (error) => {
    pending = undefined;
    throw error;
  });
  const Lazy = lazy(preload);
  // 预取完成直接渲染；只 warm import() 仍会让 React.lazy 首次读取时 suspend。
  return Object.assign((props: ComponentProps<T>) => createElement(loaded?.default ?? Lazy, props), { preload });
}
