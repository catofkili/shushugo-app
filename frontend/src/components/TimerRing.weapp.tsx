import { useEffect, useId, useRef } from "react";
import { Canvas, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";

const SIZE = 42;
const RADIUS = 18.1;

/** WeChat Canvas 2D replacement for the inline SVG timer. */
export const TimerRing = ({ remaining, total, paused }: { remaining: number; total: number; paused: boolean }) => {
  const canvasId = `vocab-timer-${useId().replace(/:/g, "")}`;
  const pixelRatio = Taro.getSystemInfoSync().pixelRatio || 1;
  const canvasRef = useRef<{ node: { width: number; height: number; getContext: (kind: "2d") => CanvasRenderingContext2D }; context: CanvasRenderingContext2D } | null>(null);
  const ratio = total ? Math.max(0, Math.min(1, remaining / total)) : 0;

  useEffect(() => {
    let alive = true;
    Taro.createSelectorQuery().select(`#${canvasId}`).fields({ node: true, size: true } as any).exec((result) => {
      if (!alive) return;
      const node = result?.[0]?.node;
      if (!node) return;
      node.width = Math.round(SIZE * pixelRatio);
      node.height = Math.round(SIZE * pixelRatio);
      const context = node.getContext("2d");
      context.scale(pixelRatio, pixelRatio);
      canvasRef.current = { node, context };
      draw(context, ratio, remaining, paused);
    });
    return () => { alive = false; canvasRef.current = null; };
  }, [canvasId, pixelRatio]);

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current.context, ratio, remaining, paused);
  }, [paused, ratio, remaining]);

  return (
    <span className={`vt-timer ${remaining <= 5 && !paused ? "is-low" : ""}`} role="timer" aria-label={paused ? "已暂停" : `剩 ${remaining} 秒`}>
      <Canvas id={canvasId} type="2d" className="vt-timer-canvas" style={{ position: "absolute", left: 0, top: 0, width: `${SIZE}px`, height: `${SIZE}px` }} />
      <b>{paused ? <Text style={{ fontSize: "13px" }}>Ⅱ</Text> : remaining}</b>
    </span>
  );
};

const draw = (context: CanvasRenderingContext2D, ratio: number, remaining: number, paused: boolean) => {
  const ctx = context;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.lineWidth = 3.75;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ece5d9";
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  if (ratio <= 0) return;
  ctx.strokeStyle = remaining <= 5 && !paused ? "#E8971C" : "#6FA83E";
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
  ctx.stroke();
};
