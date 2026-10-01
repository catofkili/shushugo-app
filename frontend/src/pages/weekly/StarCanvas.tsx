import { useEffect, useRef } from "react";
import { jsMotionAllowed } from "../../lib/studyPreferences";
import { starPainter } from "./star-painter";

/** 「星图」版的背景：一整张 canvas 画星空，DOM 只放文字。画法在 star-painter.ts（小程序版 StarCanvas.weapp.tsx 共用）。 */
export function StarCanvas({ seed, animate, burst = 0, comet = false }: { seed: string; animate: boolean; burst?: number; comet?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const motion = animate && jsMotionAllowed();
    const painter = starPainter(ctx, { seed, burst, comet, motion });
    let frame = 0;
    const start = performance.now();
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
      painter.resize(canvas.clientWidth, canvas.clientHeight, dpr);
    };
    const loop = (now: number) => { painter.draw((now - start) / 1000); frame = window.requestAnimationFrame(loop); };

    resize();
    const observer = new ResizeObserver(() => { resize(); if (!motion) painter.draw(0); });
    observer.observe(canvas);
    if (motion) frame = window.requestAnimationFrame(loop); else painter.draw(0);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [seed, animate, burst, comet]);

  return <canvas ref={ref} className="sa-canvas" aria-hidden="true" />;
}
