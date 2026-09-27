import { useEffect, useId, useRef } from "react";
import { Canvas } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { KanjiCharCard } from "../../lib/kanji-char-cards";

const WIDTH = 60;
const COLORS = { accent: "#B9A7F2", danger: "#C2493D", primary: "#6FA83E" };
type Items = NonNullable<KanjiCharCard["question"]>["items"];
type CanvasNode = { width: number; height: number; getContext: (kind: "2d") => CanvasRenderingContext2D };

/** Draw the same attempted/correct pairs on Canvas where Mini Program WXML cannot host inline SVG. */
export const KanjiPairLines = ({
  items,
  pairs,
  readings,
  revealed,
  height,
  rowHeight,
  rowGap
}: {
  items: Items;
  pairs: Record<number, number>;
  readings: string[];
  revealed: boolean;
  height: number;
  rowHeight: number;
  rowGap: number;
}) => {
  const canvasId = `kanji-reading-pair-lines-${useId().replace(/:/g, "")}`;
  const pixelRatio = Taro.getWindowInfo().pixelRatio || 1;
  const canvasRef = useRef<{ context: CanvasRenderingContext2D; node: CanvasNode } | null>(null);
  const latest = useRef({ items, pairs, readings, revealed, height, rowHeight, rowGap });
  latest.current = { items, pairs, readings, revealed, height, rowHeight, rowGap };

  useEffect(() => {
    let alive = true;
    Taro.createSelectorQuery().select(`#${canvasId}`).fields({ node: true, size: true } as any).exec((result) => {
      if (!alive) return;
      const node = result?.[0]?.node as CanvasNode | undefined;
      if (!node) return;
      node.width = Math.round(WIDTH * pixelRatio);
      node.height = Math.max(1, Math.round(height * pixelRatio));
      const context = node.getContext("2d");
      context.scale(pixelRatio, pixelRatio);
      canvasRef.current = { context, node };
      draw(context, latest.current);
    });
    return () => { alive = false; canvasRef.current = null; };
  }, [canvasId, height, pixelRatio]);

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current.context, { items, pairs, readings, revealed, height, rowHeight, rowGap });
  }, [height, items, pairs, readings, revealed, rowGap, rowHeight]);

  return (
    <Canvas
      id={canvasId}
      type="2d"
      className="kanji-pair-lines-canvas"
      style={{ position: "absolute", left: "calc(50% - 30px)", top: 0, width: `${WIDTH}px`, height: `${height}px`, zIndex: 0, pointerEvents: "none" } as any}
    />
  );
};

const draw = (
  context: CanvasRenderingContext2D,
  { items, pairs, readings, revealed, height, rowHeight, rowGap }: {
    items: Items;
    pairs: Record<number, number>;
    readings: string[];
    revealed: boolean;
    height: number;
    rowHeight: number;
    rowGap: number;
  }
) => {
  const ctx = context;
  ctx.clearRect(0, 0, WIDTH, height);
  const center = (index: number) => index * (rowHeight + rowGap) + rowHeight / 2;
  const line = (fromRow: number, toRow: number, color: string, width: number, opacity: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(0, center(fromRow));
    ctx.lineTo(WIDTH, center(toRow));
    ctx.stroke();
  };
  items.forEach((item, wordIndex) => {
    const assigned = pairs[wordIndex];
    const correct = readings.indexOf(item.targetReading);
    if (!revealed) {
      if (assigned !== undefined) line(wordIndex, assigned, COLORS.accent, 2.6, 0.8);
      return;
    }
    if (assigned !== undefined && assigned !== correct) line(wordIndex, assigned, COLORS.danger, 2.4, 0.78);
    if (correct >= 0) line(wordIndex, correct, COLORS.primary, 2.8, 0.92);
  });
  ctx.globalAlpha = 1;
};
