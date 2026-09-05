/**
 * 分享图的公共底座：尺寸、配色、圆角矩形、背景、品牌行、导出。
 *
 * 打卡图和词汇量图**必须长得像一家人**：同一块炭黑底、同一枚「語」牌、同一条日期胶囊。
 * 所以这些东西只画一遍，两张卡都从这里取 —— 复制一份出去，两张图迟早会各走各的。
 */

export const WIDTH = 1080;
export const HEIGHT = 1500;
export const MARGIN = 84;
export const MINT = "#91C968";
export const INK = "#17423C";

export const FONT_SANS = '-apple-system, "PingFang SC", "Hiragino Sans", system-ui, sans-serif';
export const FONT_SERIF = '"Hiragino Mincho ProN", "Songti SC", serif';

const WEEKDAYS_JP = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

export const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

export const drawBackground = (ctx: CanvasRenderingContext2D) => {
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, "#1D2221");
  bg.addColorStop(1, "#252B2A");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(920, 120, 0, 920, 120, 560);
  glow.addColorStop(0, "rgba(145, 201, 104, 0.13)");
  glow.addColorStop(1, "rgba(145, 201, 104, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, 700);

  // 大字水印
  ctx.save();
  ctx.fillStyle = "rgba(145, 201, 104, 0.05)";
  ctx.font = `500 560px ${FONT_SERIF}`;
  ctx.textAlign = "right";
  ctx.fillText("語", WIDTH + 110, 660);
  ctx.restore();

  // 底部青海波式细弧
  ctx.save();
  ctx.strokeStyle = "rgba(145, 201, 104, 0.07)";
  ctx.lineWidth = 2;
  for (let ring = 0; ring < 4; ring += 1) {
    ctx.beginPath();
    ctx.arc(60, HEIGHT + 40, 130 + ring * 44, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
};

/** 品牌行 + 右上角日期胶囊。`date` 传 YYYY-MM-DD。 */
export const drawBrandRow = (ctx: CanvasRenderingContext2D, date: string) => {
  const tileSize = 96;
  const tileY = 92;
  const tile = ctx.createLinearGradient(MARGIN, tileY, MARGIN + tileSize, tileY + tileSize);
  tile.addColorStop(0, "#B7E38D");
  tile.addColorStop(1, "#7EBE4F");
  roundRectPath(ctx, MARGIN, tileY, tileSize, tileSize, 26);
  ctx.fillStyle = tile;
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = `600 56px ${FONT_SERIF}`;
  ctx.textAlign = "center";
  ctx.fillText("語", MARGIN + tileSize / 2, tileY + 68);

  ctx.textAlign = "left";
  ctx.fillStyle = "#F4FAF9";
  ctx.font = `700 46px ${FONT_SANS}`;
  ctx.fillText("收集日", MARGIN + tileSize + 34, tileY + 44);
  ctx.fillStyle = "rgba(145, 201, 104, 0.62)";
  ctx.font = `700 22px ${FONT_SANS}`;
  ctx.fillText("V O C A B U L A R Y ・ G R A M M A R", MARGIN + tileSize + 34, tileY + 84);

  const weekday = WEEKDAYS_JP[new Date(`${date}T00:00:00`).getDay()];
  const label = `${date} · ${weekday}`;
  ctx.font = `600 26px ${FONT_SANS}`;
  const chipW = ctx.measureText(label).width + 56;
  const chipX = WIDTH - MARGIN - chipW;
  roundRectPath(ctx, chipX, tileY + 20, chipW, 56, 28);
  ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "rgba(244, 250, 249, 0.78)";
  ctx.fillText(label, chipX + 28, tileY + 57);
};

export const createShareCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  return { canvas, ctx };
};

export const toPngBlob = async (canvas: HTMLCanvasElement): Promise<Blob> => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("图片导出失败");
  return blob;
};
