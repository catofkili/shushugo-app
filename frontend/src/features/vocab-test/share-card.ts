import {
  createShareCanvas, drawBackground, drawBrandRow, FONT_SANS, FONT_SERIF,
  MARGIN, MINT, roundRectPath, toPngBlob, WIDTH
} from "../../lib/share-canvas";

/**
 * 词汇量分享图。和打卡图共用同一块底座（`lib/share-canvas`），所以两张图是一家人：
 * 同一块炭黑底、同一枚「語」牌、同一条日期胶囊。
 *
 * ⚠️ **图上必须写清楚这是「JLPT 词表范围内的估计」和可信度。** 这张图是拿去给人看的，
 * 而「我的日语词汇量 4,493」离开 App 之后就没人知道它是怎么算的了 ——
 * 口径不跟着图走，这个数就会被当成体检报告。
 */
export interface VocabShareInput {
  date: string;
  estimated: number;
  lower: number;
  upper: number;
  answered: number;
  totalQuestions: number;
  durationSeconds: number;
  confidence: number;
  recommendation: string;
  levels: { level: string; rate: number | null; answered: number }[];
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
};

const drawHero = (ctx: CanvasRenderingContext2D, input: VocabShareInput) => {
  ctx.textAlign = "left";
  ctx.fillStyle = MINT;
  ctx.font = `700 30px ${FONT_SANS}`;
  ctx.fillText("我的日语词汇量", MARGIN, 336);

  ctx.fillStyle = "#F4FAF9";
  ctx.font = `800 168px ${FONT_SANS}`;
  const numberText = input.estimated.toLocaleString();
  ctx.fillText(numberText, MARGIN - 6, 484);
  const numberWidth = ctx.measureText(numberText).width;
  ctx.fillStyle = "rgba(244, 250, 249, 0.55)";
  ctx.font = `700 46px ${FONT_SANS}`;
  ctx.fillText("词", MARGIN + numberWidth + 22, 480);

  roundRectPath(ctx, MARGIN, 508, 132, 10, 5);
  ctx.fillStyle = MINT;
  ctx.fill();

  // 区间胶囊：点估计边上必须有它，不然这个数看起来比它实际能给的更准
  const label = `区间 ${input.lower.toLocaleString()} – ${input.upper.toLocaleString()}`;
  ctx.font = `700 28px ${FONT_SANS}`;
  const chipW = ctx.measureText(label).width + 52;
  roundRectPath(ctx, MARGIN + numberWidth + 96, 402, chipW, 58, 29);
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "rgba(244, 250, 249, 0.72)";
  ctx.fillText(label, MARGIN + numberWidth + 96 + 26, 441);
};

const drawStatCards = (ctx: CanvasRenderingContext2D, input: VocabShareInput) => {
  const items = [
    { label: "答题数", value: `${input.answered} / ${input.totalQuestions}` },
    { label: "用时", value: formatDuration(input.durationSeconds) },
    { label: "结果可信度", value: `${input.confidence}%` }
  ];
  const cardW = 280;
  const gap = 36;
  const top = 560;
  items.forEach((item, index) => {
    const x = MARGIN + index * (cardW + gap);
    roundRectPath(ctx, x, top, cardW, 168, 30);
    ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(244, 250, 249, 0.52)";
    ctx.font = `700 26px ${FONT_SANS}`;
    ctx.fillText(item.label, x + 34, top + 62);
    ctx.fillStyle = "#F4FAF9";
    ctx.font = `800 44px ${FONT_SANS}`;
    ctx.fillText(item.value, x + 34, top + 128);
  });
};

/** 各级答对率的横条。没答过的等级画成空槽并写「未答」，不画成 0% —— 那是两件事。 */
const drawLevels = (ctx: CanvasRenderingContext2D, input: VocabShareInput) => {
  const top = 776;
  const height = 508;
  roundRectPath(ctx, MARGIN, top, WIDTH - MARGIN * 2, height, 36);
  ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#F4FAF9";
  ctx.font = `800 36px ${FONT_SANS}`;
  ctx.fillText("各级表现", MARGIN + 46, top + 70);

  ctx.textAlign = "right";
  ctx.fillStyle = MINT;
  ctx.font = `700 26px ${FONT_SANS}`;
  ctx.fillText(`建议从 ${input.recommendation} 继续`, WIDTH - MARGIN - 46, top + 68);

  const barLeft = MARGIN + 150;
  const barRight = WIDTH - MARGIN - 150;
  const barWidth = barRight - barLeft;
  input.levels.forEach((level, index) => {
    const y = top + 150 + index * 72;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(244, 250, 249, 0.72)";
    ctx.font = `800 30px ${FONT_SANS}`;
    ctx.fillText(level.level, MARGIN + 46, y + 10);

    roundRectPath(ctx, barLeft, y - 18, barWidth, 34, 17);
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    ctx.fill();

    if (level.rate != null) {
      const filled = Math.max(6, barWidth * level.rate);
      roundRectPath(ctx, barLeft, y - 18, filled, 34, 17);
      ctx.fillStyle = MINT;
      ctx.fill();
    }

    ctx.textAlign = "right";
    ctx.fillStyle = level.rate == null ? "rgba(244, 250, 249, 0.35)" : "rgba(244, 250, 249, 0.78)";
    ctx.font = `700 26px ${FONT_SANS}`;
    ctx.fillText(level.rate == null ? "未答" : `${Math.round(level.rate * 100)}%`, WIDTH - MARGIN - 46, y + 8);
  });
};

const drawFooter = (ctx: CanvasRenderingContext2D) => {
  roundRectPath(ctx, MARGIN, 1330, 8, 84, 4);
  ctx.fillStyle = MINT;
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#F4FAF9";
  ctx.font = `600 40px ${FONT_SERIF}`;
  ctx.fillText("「知らない言葉は、まだ会っていない友達」", MARGIN + 38, 1368);
  ctx.fillStyle = "rgba(244, 250, 249, 0.5)";
  ctx.font = `600 26px ${FONT_SANS}`;
  ctx.fillText("JLPT 词表覆盖范围内的抽样估计 · 仅供参考", MARGIN + 42, 1410);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(244, 250, 249, 0.35)";
  ctx.font = `600 24px ${FONT_SANS}`;
  ctx.fillText("收集日 · 查词汇量", WIDTH - MARGIN, 1410);
};

export const renderVocabShareCard = async (input: VocabShareInput): Promise<Blob> => {
  const { canvas, ctx } = createShareCanvas();
  drawBackground(ctx);
  drawBrandRow(ctx, input.date);
  drawHero(ctx, input);
  drawStatCards(ctx, input);
  drawLevels(ctx, input);
  drawFooter(ctx);
  return toPngBlob(canvas);
};
