import { useContext, useEffect, useId, useState } from "react";
import { Canvas } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { jsMotionAllowed } from "../../lib/studyPreferences";
import { starPainter } from "./star-painter";
import { WeeklyCoveredContext } from "./covered";

type CanvasNode = {
  width: number; height: number;
  getContext: (kind: "2d") => CanvasRenderingContext2D;
  requestAnimationFrame: (callback: () => void) => number;
  cancelAnimationFrame: (id: number) => void;
};

/**
 * 小程序版星空背景：Taro 的 <canvas> 元素没有 getContext（网页版在这里直接 TypeError，整页周报挂掉），
 * 要用 Canvas 2D + SelectorQuery 拿节点，帧循环用节点自己的 requestAnimationFrame。画法和网页共用 star-painter.ts。
 */
export function StarCanvas({ seed, animate, burst = 0, comet = false }: { seed: string; animate: boolean; burst?: number; comet?: boolean }) {
  const canvasId = `sa-canvas-${useId().replace(/:/g, "")}`;

  const [ready, setReady] = useState(false);
  // 弹层开着时不渲染：原生 Canvas 在开发者工具里会画在弹层上面，display:none 也藏不掉。
  const covered = useContext(WeeklyCoveredContext);
  const show = ready && !covered;
  useEffect(() => {
    // 原生 Canvas 在 wr-stage / sa-orbit-wrap 的 transform 入场中挂载会缓存偏移；
    // 重画不能修正，要等最长 .5s 延迟 + 1s 入场结束再挂载（与 star-figures.weapp 一致）。
    const timer = setTimeout(() => setReady(true), 1600);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!show) return;
    let alive = true;
    let node: CanvasNode | null = null;
    let frame = 0;
    Taro.createSelectorQuery().select(`#${canvasId}`).fields({ node: true, size: true } as Taro.NodesRef.Fields).exec((result) => {
      const found = result?.[0] as { node?: CanvasNode; width?: number; height?: number } | undefined;
      if (!alive || !found?.node || !found.width || !found.height) return;
      node = found.node;
      const ctx = node.getContext("2d");
      const motion = animate && jsMotionAllowed();
      const painter = starPainter(ctx, { seed, burst, comet, motion });
      const dpr = Math.min(2, Taro.getWindowInfo().pixelRatio || 1);
      node.width = Math.round(found.width * dpr); node.height = Math.round(found.height * dpr);
      painter.resize(found.width, found.height, dpr);
      const start = Date.now();
      const loop = () => {
        if (!alive || !node) return;
        painter.draw((Date.now() - start) / 1000);
        frame = node.requestAnimationFrame(loop);
      };
      if (motion) loop(); else painter.draw(0);
    });
    return () => { alive = false; if (node && frame) node.cancelAnimationFrame(frame); };
  }, [canvasId, seed, animate, burst, comet, show]);

  return show ? <Canvas type="2d" id={canvasId} className="sa-canvas" /> : null;
}
