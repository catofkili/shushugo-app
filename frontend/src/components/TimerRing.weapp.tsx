import { useEffect } from "react";
import { Canvas } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Pause } from "lucide-react";

const CANVAS_ID = "vocab-test-timer-ring";
const SIZE = 36;
const RADIUS = 15.5;

/** WeChat Canvas replacement for the inline SVG ring; the label and timing are shared. */
export const TimerRing = ({ remaining, total, paused }: { remaining: number; total: number; paused: boolean }) => {
  const ratio = total ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const pixelRatio = Taro.getSystemInfoSync().pixelRatio || 1;

  useEffect(() => {
    const context = Taro.createCanvasContext(CANVAS_ID);
    context.scale(pixelRatio, pixelRatio);
    context.setLineWidth(3.2);
    context.setLineCap("round");
    context.setStrokeStyle("#ece5d9");
    context.beginPath();
    context.arc(18, 18, RADIUS, 0, Math.PI * 2);
    context.stroke();
    if (ratio > 0) {
      context.setStrokeStyle(remaining <= 5 && !paused ? "#E8971C" : "#6FA83E");
      context.beginPath();
      context.arc(18, 18, RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      context.stroke();
    }
    context.draw();
  }, [pixelRatio, paused, ratio, remaining]);

  return (
    <span className={`vt-timer ${remaining <= 5 && !paused ? "is-low" : ""}`} role="timer" aria-label={paused ? "已暂停" : `剩 ${remaining} 秒`}>
      <Canvas canvasId={CANVAS_ID} width={SIZE * pixelRatio} height={SIZE * pixelRatio} className="vt-timer-canvas" />
      <b>{paused ? <Pause size={13} /> : remaining}</b>
    </span>
  );
};
