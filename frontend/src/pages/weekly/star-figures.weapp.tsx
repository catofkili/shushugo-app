import { useEffect, useId, useState } from "react";
import { Canvas, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { WeeklyReport } from "../../lib/analytics/weekly";
import { weekday } from "../WeeklyReportStory";

type Props = { daily: WeeklyReport["metrics"]["daily"] };
type CanvasNode = { width: number; height: number; getContext: (kind: "2d") => CanvasRenderingContext2D };

// star-atlas.css 的 cover / effort（时间）章；Canvas 读不到 CSS 变量。
const COVER_FG = "#f4efff"; // cover --wr-fg
const COVER_POP = "#ffd88a"; // cover --wr-pop
const COVER_MUTED = "#aab0d6"; // cover --wr-muted
const TIME_FG = "#eefcff"; // effort --wr-fg
const TIME_POP = "#8ff0dc"; // effort --wr-pop
const TIME_MUTED = "#9fbfcc"; // effort --wr-muted
const DIPPER = [[28, 44], [40, 104], [104, 116], [116, 60], [172, 52], [220, 58], [290, 100]] as const;
const DIPPER_LINKS = [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] as const;

// 对齐 SVG 默认的 xMidYMid meet；只画终态，暂停 / 减弱动效时也是这一帧。
function useFigure(daily: Props["daily"], height: number, draw: (ctx: CanvasRenderingContext2D, daily: Props["daily"], pixelScale: number) => void) {
  const id = `sa-figure-${useId().replace(/:/g, "")}`;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Canvas 2D 在祖先 transform 入场时挂载，会把当时的偏移缓存到原生绘图层；
    // 单纯重画 / 改尺寸不能修正，模拟器已复现。等 wr-stage 的 1s 和
    // sa-orbit-wrap 的 .5s 延迟 + 1s 入场结束再挂载，图本身不做入场动画。
    const timer = setTimeout(() => setReady(true), 1600);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const paint = () => Taro.createSelectorQuery().select(`#${id}`).fields({ node: true, size: true } as Taro.NodesRef.Fields).exec((result) => {
      const found = result?.[0] as { node?: CanvasNode; width?: number; height?: number } | undefined;
      if (!alive || !found?.node || !found.width || !found.height) return;
      const { node, width, height: measuredHeight } = found;
      const dpr = Taro.getWindowInfo().pixelRatio || 1;
      node.width = Math.round(width * dpr); node.height = Math.round(measuredHeight * dpr);
      const ctx = node.getContext("2d");
      const scale = Math.min(width / 320, measuredHeight / height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate((width - 320 * scale) / 2, (measuredHeight - height * scale) / 2);
      ctx.scale(scale, scale);
      draw(ctx, daily, scale * dpr);
    });
    Taro.nextTick(paint);
    Taro.onWindowResize(paint);
    return () => { alive = false; Taro.offWindowResize(paint); };
  }, [id, daily, height, draw, ready]);
  return { id, ready };
}

function drawDipper(ctx: CanvasRenderingContext2D, daily: Props["daily"]) {
  const peak = Math.max(1, ...daily.map((day) => day.reviews));
  const lit = (i: number) => (daily[i]?.reviews ?? 0) > 0 || (daily[i]?.seconds ?? 0) > 0;
  DIPPER_LINKS.forEach(([a, b]) => {
    const on = lit(a) && lit(b);
    ctx.globalAlpha = on ? .7 : .22 * .55;
    ctx.strokeStyle = on ? COVER_POP : COVER_FG;
    ctx.lineWidth = on ? 1.4 : 1;
    ctx.beginPath(); ctx.moveTo(...DIPPER[a]); ctx.lineTo(...DIPPER[b]); ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.font = '700 11px -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';
  DIPPER.forEach(([x, y], i) => {
    const on = lit(i);
    const r = on ? 3.5 + 4.5 * Math.sqrt((daily[i]?.reviews ?? 0) / peak) : 1.8;
    if (on) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      glow.addColorStop(0, "#fff3cf"); glow.addColorStop(.35, "rgba(255,216,138,.55)"); glow.addColorStop(1, "#ffd88a00");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = on ? 1 : .35;
    ctx.fillStyle = on ? "#fff6de" : COVER_FG;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = on ? COVER_POP : COVER_MUTED;
    ctx.fillText(weekday(daily[i]?.date ?? ""), x, y + ([0, 3, 4, 5].includes(i) ? -14 : 22));
  });
}

function drawRays(ctx: CanvasRenderingContext2D, daily: Props["daily"], pixelScale: number) {
  const peak = Math.max(1, ...daily.map((day) => day.reviews));
  ctx.strokeStyle = TIME_FG; ctx.globalAlpha = .12; ctx.lineWidth = 1;
  [150, 112].forEach((r, i) => {
    ctx.setLineDash(i ? [1, 5] : [2, 7]);
    ctx.beginPath(); ctx.arc(160, 160, r, 0, Math.PI * 2); ctx.stroke();
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineCap = "round";
  ctx.textAlign = "center";
  ctx.font = '700 12px -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';
  daily.forEach((day, i) => {
    const angle = (-90 + (i * 360) / daily.length) * (Math.PI / 180);
    const len = day.reviews ? 22 + 62 * (day.reviews / peak) : 14;
    const isPeak = day.reviews === peak && day.reviews > 0;
    ctx.save();
    ctx.globalAlpha = isPeak ? 1 : day.reviews ? .7 : .18;
    ctx.strokeStyle = day.reviews ? TIME_POP : TIME_FG;
    ctx.lineWidth = isPeak ? 7 : day.reviews ? 5 : 3;
    // SVG drop-shadow 的 6px 是高斯标准差，Canvas shadowBlur 的标准差为其一半；它不随 transform 缩放。
    if (isPeak) { ctx.shadowColor = TIME_POP; ctx.shadowBlur = 12 * pixelScale; }
    ctx.beginPath();
    ctx.moveTo(160 + Math.cos(angle) * 58, 160 + Math.sin(angle) * 58);
    ctx.lineTo(160 + Math.cos(angle) * (58 + len), 160 + Math.sin(angle) * (58 + len));
    ctx.stroke(); ctx.restore();
    ctx.fillStyle = isPeak ? TIME_POP : TIME_MUTED;
    ctx.fillText(weekday(day.date), 160 + Math.cos(angle) * (72 + len), 160 + Math.sin(angle) * (72 + len) + 4);
  });
}

export function Dipper({ daily }: Props) {
  const { id, ready } = useFigure(daily, 150, drawDipper);
  // 原生 Canvas 没有 SVG viewBox 的内在宽高比，用百分比占位保持 320 × 150，max-width / margin 沿用原类。
  return <View className="sa-dipper" style={{ position: "relative" }}>
    <View style={{ paddingTop: "46.875%" }} />
    {ready && <Canvas type="2d" id={id} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}
  </View>;
}

export function Rays({ daily }: Props) {
  const { id, ready } = useFigure(daily, 320, drawRays);
  return ready ? <Canvas type="2d" id={id} className="sa-rays" /> : null;
}
