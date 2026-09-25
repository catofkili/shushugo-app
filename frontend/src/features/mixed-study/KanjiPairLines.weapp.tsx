import { useEffect } from "react";
import { Canvas } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { KanjiCharCard } from "../../lib/kanji-char-cards";

const WIDTH = 60;
const CANVAS_ID = "kanji-reading-pair-lines";
const COLORS = { accent: "#B9A7F2", danger: "#C2493D", primary: "#6FA83E" };

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
  items: NonNullable<KanjiCharCard["question"]>["items"];
  pairs: Record<number, number>;
  readings: string[];
  revealed: boolean;
  height: number;
  rowHeight: number;
  rowGap: number;
}) => {
  const pixelRatio = Taro.getSystemInfoSync().pixelRatio || 1;
  const center = (index: number) => index * (rowHeight + rowGap) + rowHeight / 2;

  useEffect(() => {
    const context = Taro.createCanvasContext(CANVAS_ID);
    context.scale(pixelRatio, pixelRatio);
    const line = (fromRow: number, toRow: number, color: string, width: number, opacity: number) => {
      context.setStrokeStyle(color);
      context.setLineWidth(width);
      context.setLineCap("round");
      context.setGlobalAlpha(opacity);
      context.beginPath();
      context.moveTo(0, center(fromRow));
      context.lineTo(WIDTH, center(toRow));
      context.stroke();
    };
    items.forEach((item, wordIndex) => {
      const assigned = pairs[wordIndex];
      const correct = readings.indexOf(item.targetReading);
      if (!revealed) {
        if (assigned !== undefined) line(wordIndex, assigned, COLORS.accent, 2.6, 0.8);
        return;
      }
      if (assigned !== undefined && assigned !== correct) line(wordIndex, assigned, COLORS.danger, 2.4, 0.78);
      line(wordIndex, correct, COLORS.primary, 2.8, 0.92);
    });
    context.setGlobalAlpha(1);
    context.draw();
  }, [height, items, pairs, pixelRatio, readings, revealed, rowGap, rowHeight]);

  return (
    <Canvas
      canvasId={CANVAS_ID}
      width={WIDTH * pixelRatio}
      height={height * pixelRatio}
      className="kanji-pair-lines-canvas"
      style={{ height: `${height}px` }}
    />
  );
};
