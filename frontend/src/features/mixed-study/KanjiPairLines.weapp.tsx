import { useEffect } from "react";
import { Canvas } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { KanjiCharCard } from "../../lib/kanji-char-cards";

const ROW_HEIGHT = 68;
const WIDTH = 60;
const CANVAS_ID = "kanji-reading-pair-lines";

/** Draw the same attempted/correct pairs on Canvas where Mini Program WXML cannot host inline SVG. */
export const KanjiPairLines = ({
  items,
  pairs,
  readings,
  revealed
}: {
  items: NonNullable<KanjiCharCard["question"]>["items"];
  pairs: Record<number, number>;
  readings: string[];
  revealed: boolean;
}) => {
  const pixelRatio = Taro.getSystemInfoSync().pixelRatio || 1;
  const height = items.length * ROW_HEIGHT;

  useEffect(() => {
    const context = Taro.createCanvasContext(CANVAS_ID);
    context.scale(pixelRatio, pixelRatio);
    const line = (fromRow: number, toRow: number, color: string, width: number, opacity: number) => {
      context.setStrokeStyle(color);
      context.setLineWidth(width);
      context.setLineCap("round");
      context.setGlobalAlpha(opacity);
      context.beginPath();
      context.moveTo(0, (fromRow + 0.5) * ROW_HEIGHT);
      context.lineTo(WIDTH, (toRow + 0.5) * ROW_HEIGHT);
      context.stroke();
    };
    items.forEach((item, wordIndex) => {
      const assigned = pairs[wordIndex];
      const correct = readings.indexOf(item.targetReading);
      if (!revealed) {
        if (assigned !== undefined) line(wordIndex, assigned, "#d7b5f1", 2.6, 0.8);
        return;
      }
      if (assigned !== undefined && assigned !== correct) line(wordIndex, assigned, "#f19595", 2.4, 0.78);
      line(wordIndex, correct, "#81D8CF", 2.8, 0.92);
    });
    context.setGlobalAlpha(1);
    context.draw();
  }, [height, items, pairs, pixelRatio, readings, revealed]);

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
