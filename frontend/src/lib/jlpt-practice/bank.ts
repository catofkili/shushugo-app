import type { JlptBank, JlptLevel } from "./types";

// 静态路径和 lazy 注释缺一不可：Vite 按等级拆块，Taro 用 require.async 从 lazy 分包读。
const imports = {
  N1: () => import(/* webpackMode: "lazy", webpackChunkName: "lazy/jlpt-n1" */ "../../data/jlpt/n1.json"),
  N2: () => import(/* webpackMode: "lazy", webpackChunkName: "lazy/jlpt-n2" */ "../../data/jlpt/n2.json"),
  N3: () => import(/* webpackMode: "lazy", webpackChunkName: "lazy/jlpt-n3" */ "../../data/jlpt/n3.json"),
  N4: () => import(/* webpackMode: "lazy", webpackChunkName: "lazy/jlpt-n4" */ "../../data/jlpt/n4.json"),
  N5: () => import(/* webpackMode: "lazy", webpackChunkName: "lazy/jlpt-n5" */ "../../data/jlpt/n5.json")
};
const loading = new Map<JlptLevel, Promise<JlptBank>>();

/** 同级并发共享请求；失败必须清掉，不能让一次断网永久封死题库。 */
export const loadJlptBank = (level: JlptLevel): Promise<JlptBank> => {
  const existing = loading.get(level);
  if (existing) return existing;
  const request = imports[level]().then((module) => module.default as JlptBank).catch((error: unknown) => {
    loading.delete(level);
    throw error;
  });
  loading.set(level, request);
  return request;
};
