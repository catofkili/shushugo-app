import { useEffect, useRef } from "react";
import { jsMotionAllowed } from "../../lib/studyPreferences";

/**
 * 「星图」版的背景：一整张 canvas 画星空，DOM 只放文字。
 *
 * - 进场：所有星星从画面中心炸开、拖着尾巴落到自己的位置（约 1.1 秒），之后原地闪烁、极慢地漂。
 * - burst：新词页从中心迸出 N 颗金色新星（上限 160，一颗代表一个新词；超过就不再一一对应）。
 * - comet：流星页每 3.4 秒划过一颗（进页 0.5 秒就来第一颗 —— 等太久的话这一页看起来什么都没发生）。
 *
 * ⚠️ animate=false（离场副本、暂停、后台）或系统 / 应用关了动效时只画一帧静止的终态，不起 rAF。
 * 星星位置由 seed 决定（同一周同一页每次打开一样），不要换成 Math.random —— 翻回来星空跳位很出戏。
 */
const mulberry = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

export function StarCanvas({ seed, animate, burst = 0, comet = false }: { seed: string; animate: boolean; burst?: number; comet?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const motion = animate && jsMotionAllowed();
    const rand = mulberry(hash(seed));
    const stars = Array.from({ length: 170 }, () => ({
      x: rand(), y: rand(), r: 0.35 + rand() ** 3 * 1.7, phase: rand() * Math.PI * 2, speed: 0.6 + rand() * 1.6, warm: rand() < 0.18
    }));
    const births = Array.from({ length: Math.min(burst, 160) }, () => ({
      angle: rand() * Math.PI * 2, dist: 0.12 + rand() ** 0.7 * 0.5, r: 0.9 + rand() * 1.5, delay: rand() * 0.6, phase: rand() * Math.PI * 2
    }));
    let width = 0; let height = 0; let frame = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const dot = (x: number, y: number, r: number, color: string, glow: number) => {
      if (glow > 0) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * glow);
        g.addColorStop(0, color); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * glow, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };

    const draw = (now: number) => {
      const t = motion ? (now - start) / 1000 : 99;
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2; const cy = height * 0.4;
      const warp = Math.max(0, 1 - t / 1.1);
      const settle = 1 - warp ** 3;
      for (const s of stars) {
        const drift = motion ? Math.sin(t * 0.05 + s.phase) * s.r * 5 : 0;
        const tx = s.x * width + drift; const ty = s.y * height;
        const x = cx + (tx - cx) * (0.04 + 0.96 * settle); const y = cy + (ty - cy) * (0.04 + 0.96 * settle);
        const twinkle = motion ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s.phase + t * s.speed)) : 0.8;
        if (warp > 0.02) {
          ctx.strokeStyle = `rgba(210,220,255,${0.55 * warp})`; ctx.lineWidth = s.r;
          ctx.beginPath(); ctx.moveTo(cx + (x - cx) * (1 - warp * 0.5), cy + (y - cy) * (1 - warp * 0.5)); ctx.lineTo(x, y); ctx.stroke();
        }
        dot(x, y, s.r, s.warm ? `rgba(255,222,170,${twinkle})` : `rgba(235,238,255,${twinkle})`, s.r > 1.3 ? 4 : 0);
      }
      const unit = Math.min(width, height);
      for (const b of births) {
        const u = Math.min(1, Math.max(0, (t - 0.9 - b.delay) / 1.5));
        if (u <= 0) continue;
        const e = 1 - (1 - u) ** 3;
        const x = cx + Math.cos(b.angle) * b.dist * unit * e * 1.25; const y = cy + Math.sin(b.angle) * b.dist * unit * e;
        if (u < 1) {
          ctx.strokeStyle = `rgba(255,214,140,${0.7 * (1 - u)})`; ctx.lineWidth = b.r;
          ctx.beginPath(); ctx.moveTo(cx + (x - cx) * 0.7, cy + (y - cy) * 0.7); ctx.lineTo(x, y); ctx.stroke();
        }
        const twinkle = motion && u >= 1 ? 0.6 + 0.4 * Math.sin(b.phase + t * 2) : 1;
        dot(x, y, b.r, `rgba(255,216,138,${twinkle})`, 5);
      }
      if (comet) {
        const p = motion ? ((t + 2.9) % 3.4) / 3.4 : 0.3;
        if (p < 0.6) {
          const k = p / 0.6;
          const x = -0.15 * width + k * width * 1.3; const y = height * (0.08 + k * 0.42);
          const tail = ctx.createLinearGradient(x, y, x - 260, y - 90);
          tail.addColorStop(0, "rgba(210,240,255,.95)"); tail.addColorStop(1, "rgba(210,240,255,0)");
          ctx.strokeStyle = tail; ctx.lineWidth = 3; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 260, y - 90); ctx.stroke();
          dot(x, y, 3, "rgba(245,252,255,1)", 7);
        }
      }
      if (motion) frame = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(() => { resize(); if (!motion) draw(0); });
    observer.observe(canvas);
    if (motion) frame = window.requestAnimationFrame(draw); else draw(0);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [seed, animate, burst, comet]);

  return <canvas ref={ref} className="sa-canvas" aria-hidden="true" />;
}
