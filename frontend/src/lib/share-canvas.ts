/**
 * 分享图的公共底座：尺寸、配色、圆角矩形、背景、品牌行、卡片、贴纸、导出。
 *
 * 打卡图和词汇量图**必须长得像一家人**：同一张奶油纸底、同一枚 App 图标、同一条日期胶囊、
 * 同一种白卡。所以这些东西只画一遍，两张卡都从这里取 —— 复制一份出去，两张图迟早会各走各的。
 *
 * 2026-09-24 从「炭黑底 + 語 牌」换成和 App 一样的浅纸 + 吉祥物（设计系统重做那一轮之后，
 * 分享图还是老品牌，拿出去的东西和 App 里看到的不是一家人）。
 * 贴纸和图标是 `public/brand/` 下的本地文件，离线也画得出来；加载失败就不画那一块，不让整张图失败。
 */

export const WIDTH = 1080;
export const HEIGHT = 1500;
export const MARGIN = 84;
export const INNER = WIDTH - MARGIN * 2;

/** 固定的浅色纸面配色：分享图离开 App 之后没有主题可跟，所以不读 CSS 变量 */
export const PAPER = "#FBF6EC";
export const CARD = "#FFFFFF";
export const INSET = "#F4EDE1";
export const INK = "#2B241C";
export const INK2 = "#5E5448";
export const INK3 = "#978C7E";
export const PRIMARY = "#7EBE4F";
export const PRIMARY_DEEP = "#3F6B22";
export const PRIMARY_TINT = "#E8F2DA";
export const ON_PRIMARY = "#1B2E10";
export const GOLD = "#F5C15C";
export const GOLD_INK = "#4A3407";

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

/** 本地图片 → 可画的 Image；读不到返回 null（调用方跳过那一块） */
export const loadImage = (src: string): Promise<HTMLImageElement | null> => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

/** 按高度画一张贴纸，宽度随原图比例；`anchor` 是右下角 */
export const drawSticker = (ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, right: number, bottom: number, height: number) => {
  if (!image) return;
  const width = (image.naturalWidth / image.naturalHeight) * height;
  ctx.drawImage(image, right - width, bottom - height, width, height);
};

export const drawBackground = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // 右上一团新绿、左下一团暖橙，纸面不至于是一整块平涂
  // ⚠️ 渐变的终点必须是「同色 alpha 0」：写成透明黑，中间那段会插值出一圈发灰的晕
  const blobs: Array<[number, number, number, string]> = [
    [940, 160, 620, "126, 190, 79"],
    [80, HEIGHT - 80, 560, "232, 151, 28"]
  ];
  for (const [x, y, r, rgb] of blobs) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `rgba(${rgb}, 0.14)`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
};

/** 白卡：发丝线 + 淡投影，和 App 里的 .ds-card 同一种面 */
export const drawCard = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill = CARD) => {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 36);
  ctx.shadowColor = "rgba(60, 45, 30, 0.10)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  if (fill === CARD) {
    roundRectPath(ctx, x, y, w, h, 36);
    ctx.strokeStyle = "rgba(60, 45, 30, 0.07)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
};

/** 实心胶囊（徽章 / 区间）。返回胶囊宽度，方便往右接着排。 */
export const drawChip = (ctx: CanvasRenderingContext2D, x: number, y: number, label: string, fill: string, color: string) => {
  ctx.font = `700 28px ${FONT_SANS}`;
  const w = ctx.measureText(label).width + 52;
  roundRectPath(ctx, x, y, w, 58, 29);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.fillText(label, x + 26, y + 39);
  return w;
};

/** 数字字号从 max 往下收，直到「数字 + 单位」放得进 maxWidth */
export const drawBigNumber = (ctx: CanvasRenderingContext2D, text: string, unit: string, x: number, baseline: number, maxWidth: number) => {
  let size = 200;
  for (; size > 96; size -= 8) {
    ctx.font = `800 ${size}px ${FONT_SANS}`;
    const numberWidth = ctx.measureText(text).width;
    ctx.font = `800 ${Math.round(size * 0.26)}px ${FONT_SANS}`;
    if (numberWidth + 18 + ctx.measureText(unit).width <= maxWidth) break;
  }
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `800 ${size}px ${FONT_SANS}`;
  ctx.fillText(text, x - 6, baseline);
  const numberWidth = ctx.measureText(text).width;
  ctx.fillStyle = INK2;
  ctx.font = `800 ${Math.round(size * 0.26)}px ${FONT_SANS}`;
  ctx.fillText(unit, x + numberWidth + 12, baseline - 6);
};

/** 三枚并排的小数字卡（用时 / 连击 / 可信度…） */
export const drawStatCards = (ctx: CanvasRenderingContext2D, top: number, items: Array<{ label: string; value: string }>) => {
  const gap = 24;
  const cardW = (INNER - gap * (items.length - 1)) / items.length;
  items.forEach((item, index) => {
    const x = MARGIN + index * (cardW + gap);
    drawCard(ctx, x, top, cardW, 150);
    ctx.textAlign = "left";
    ctx.fillStyle = INK3;
    ctx.font = `700 26px ${FONT_SANS}`;
    ctx.fillText(item.label, x + 34, top + 56);
    ctx.fillStyle = INK;
    ctx.font = `800 44px ${FONT_SANS}`;
    ctx.fillText(item.value, x + 34, top + 116);
  });
};

/** 品牌行（App 图标 + 名字）+ 右上角日期胶囊。`date` 传 YYYY-MM-DD，`iconUrl` 跟吉祥物皮肤走。 */
export const drawBrandRow = async (ctx: CanvasRenderingContext2D, date: string, iconUrl: string) => {
  const tileSize = 96;
  const tileY = 84;
  const icon = await loadImage(iconUrl);
  if (icon) {
    ctx.save();
    roundRectPath(ctx, MARGIN, tileY, tileSize, tileSize, 26);
    ctx.clip();
    ctx.drawImage(icon, MARGIN, tileY, tileSize, tileSize);
    ctx.restore();
  }

  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `800 46px ${FONT_SANS}`;
  ctx.fillText("收集日", MARGIN + tileSize + 30, tileY + 50);
  ctx.fillStyle = INK3;
  ctx.font = `700 24px ${FONT_SANS}`;
  ctx.fillText("ShuShuGo · 每天收集一点日语", MARGIN + tileSize + 30, tileY + 86);

  const weekday = WEEKDAYS_JP[new Date(`${date}T00:00:00`).getDay()];
  const label = `${date.replace(/-/g, ".")} · ${weekday}`;
  ctx.font = `700 26px ${FONT_SANS}`;
  const chipW = ctx.measureText(label).width + 56;
  const chipX = WIDTH - MARGIN - chipW;
  roundRectPath(ctx, chipX, tileY + 20, chipW, 56, 28);
  ctx.fillStyle = INSET;
  ctx.fill();
  ctx.fillStyle = INK2;
  ctx.fillText(label, chipX + 28, tileY + 57);
};

/** 底部一句话：左边一道主色竖条 + 日文（衬线）+ 中文小字，右下角落款 */
export const drawFooter = (ctx: CanvasRenderingContext2D, quote: string, note: string, signature: string) => {
  const top = 1362;
  roundRectPath(ctx, MARGIN, top, 8, 84, 4);
  ctx.fillStyle = PRIMARY;
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `600 38px ${FONT_SERIF}`;
  ctx.fillText(quote, MARGIN + 34, top + 38);
  ctx.fillStyle = INK3;
  ctx.font = `600 24px ${FONT_SANS}`;
  ctx.fillText(note, MARGIN + 38, top + 78);
  ctx.textAlign = "right";
  ctx.fillText(signature, WIDTH - MARGIN, top + 78);
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
