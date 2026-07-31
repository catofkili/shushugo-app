// 动词自他标注。中文「开」一个字通吃 開く/開ける,自他之分是中文母语学习者最容易
// 翻车的地方,所以标注直接挂在词本身,而不是只在「自他动词对应」面板里提配对词。
//
// 表来自 JMdict 的 vi/vt 标签(见 scripts/build-verb-transitivity.mjs),覆盖词库
// 99.3% 的动词。77KB —— 和读音表一样走动态 import 单独成 chunk,不进主包。
//
// 键是「表记|假名」:開く 读 あく 是纯自动词、读 ひらく 自他兼,只按表记查会混。

import { useEffect, useState } from "react";

export type Transitivity = "自" | "他" | "自他";

let table: Record<string, Transitivity> | null = null;
let loading: Promise<void> | null = null;

export const loadTransitivity = (): Promise<void> => {
  if (table) return Promise.resolve();
  loading ??= import("../data/verb_transitivity.json").then((module) => {
    table = (module.default as { transitivity: Record<string, Transitivity> }).transitivity;
  });
  return loading;
};

export const transitivityLoaded = () => table !== null;

/** 查不到就返回 null —— 标错比不标糟,不猜。 */
export function lookupTransitivity(kanji: string, kana: string, pos: string): Transitivity | null {
  if (!table || !pos.includes("动词")) return null;
  return table[`${kanji || kana}|${kana}`] ?? null;
}

/** 表是异步加载的:加载完触发一次重渲染,标注补上。 */
export function useTransitivityReady(): boolean {
  const [ready, setReady] = useState(transitivityLoaded());
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadTransitivity().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}
