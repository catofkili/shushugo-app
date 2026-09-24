import {
  CARD, createShareCanvas, drawBackground, drawBigNumber, drawBrandRow, drawCard, drawChip, drawFooter, drawStatCards, drawSticker,
  FONT_SANS, INK, INK2, INK3, INNER, INSET, loadImage, MARGIN, PRIMARY, PRIMARY_DEEP, PRIMARY_TINT, roundRectPath, toPngBlob, WIDTH
} from "../../lib/share-canvas";
import { brandIconUrl, stickerUrl } from "../../components/CapybaraMascot";

/**
 * 词汇量分享图。和打卡图共用同一块底座（`lib/share-canvas`），所以两张图是一家人：
 * 同一张浅纸、同一枚 App 图标、同一条日期胶囊。
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
  scoreVersion: 1 | 2;
  recommendation: string;
  levels: { level: string; rate: number | null; answered: number }[];
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
};

/** 顶上那块浅绿大卡：点估计 + 区间胶囊 + 右下角一只得意的吉祥物 */
const drawHero = async (ctx: CanvasRenderingContext2D, input: VocabShareInput) => {
  const top = 232;
  const height = 380;
  drawCard(ctx, MARGIN, top, INNER, height, PRIMARY_TINT);
  const mascot = await loadImage(stickerUrl("mood-proud"));
  const mascotHeight = 300;
  const mascotWidth = mascot ? (mascot.naturalWidth / mascot.naturalHeight) * mascotHeight : 0;
  drawSticker(ctx, mascot, WIDTH - MARGIN - 28, top + height - 14, mascotHeight);

  ctx.textAlign = "left";
  ctx.fillStyle = PRIMARY_DEEP;
  ctx.font = `800 32px ${FONT_SANS}`;
  ctx.fillText("我的日语词汇量", MARGIN + 56, top + 78);
  drawBigNumber(ctx, input.estimated.toLocaleString(), "词", MARGIN + 56, top + 262, INNER - 112 - mascotWidth);
  // 区间胶囊：点估计边上必须有它，不然这个数看起来比它实际能给的更准
  drawChip(ctx, MARGIN + 56, top + 290, `区间 ${input.lower.toLocaleString()} – ${input.upper.toLocaleString()}`, CARD, INK2);
};

/** 各级答对率的横条。没答过的等级画成空槽并写「未答」，不画成 0% —— 那是两件事。 */
const drawLevels = (ctx: CanvasRenderingContext2D, input: VocabShareInput) => {
  const top = 818;
  drawCard(ctx, MARGIN, top, INNER, 500);

  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `800 36px ${FONT_SANS}`;
  ctx.fillText("各级表现", MARGIN + 46, top + 70);

  ctx.textAlign = "right";
  ctx.fillStyle = PRIMARY_DEEP;
  ctx.font = `700 26px ${FONT_SANS}`;
  ctx.fillText(`建议从 ${input.recommendation} 继续`, WIDTH - MARGIN - 46, top + 68);

  const barLeft = MARGIN + 150;
  const barRight = WIDTH - MARGIN - 150;
  const barWidth = barRight - barLeft;
  input.levels.forEach((level, index) => {
    const y = top + 164 + index * 72;
    ctx.textAlign = "left";
    ctx.fillStyle = INK2;
    ctx.font = `800 30px ${FONT_SANS}`;
    ctx.fillText(level.level, MARGIN + 46, y + 10);

    roundRectPath(ctx, barLeft, y - 16, barWidth, 32, 16);
    ctx.fillStyle = INSET;
    ctx.fill();
    if (level.rate != null) {
      roundRectPath(ctx, barLeft, y - 16, Math.max(32, barWidth * level.rate), 32, 16);
      ctx.fillStyle = PRIMARY;
      ctx.fill();
    }

    ctx.textAlign = "right";
    ctx.fillStyle = level.rate == null ? INK3 : INK;
    ctx.font = `700 26px ${FONT_SANS}`;
    ctx.fillText(level.rate == null ? "未答" : `${Math.round(level.rate * 100)}%`, WIDTH - MARGIN - 46, y + 9);
  });
};

export const renderVocabShareCard = async (input: VocabShareInput): Promise<Blob> => {
  const { canvas, ctx } = createShareCanvas();
  drawBackground(ctx);
  await drawBrandRow(ctx, input.date, brandIconUrl());
  await drawHero(ctx, input);
  drawStatCards(ctx, 640, [
    { label: "答题数", value: `${input.answered} / ${input.totalQuestions}` },
    { label: "用时", value: formatDuration(input.durationSeconds) },
    { label: "结果可信度", value: `${input.confidence}%` }
  ]);
  drawLevels(ctx, input);
  drawFooter(
    ctx,
    "「知らない言葉は、まだ会っていない友達」",
    input.scoreVersion === 1 ? "旧版计分 · 请重测后再参考" : "JLPT 词表覆盖范围内的抽样估计 · 仅供参考",
    "收集日 · 查词汇量"
  );
  return toPngBlob(canvas);
};
