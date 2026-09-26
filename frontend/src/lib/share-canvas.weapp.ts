declare const wx: any;

export const WIDTH = 1080;
export const HEIGHT = 1500;
export const MARGIN = 84;
export const INNER = WIDTH - MARGIN * 2;
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

type WeappCanvas = any;
export type WeappShareBlob = Blob & { __wxFilePath: string; __wxDataUrl: string; };
let currentCanvas: WeappCanvas | null = null;
let fileSequence = 0;

const normalizeImagePath = (src: string) => String(src).replace(/^\//, "").replace(/^brand\//, "assets/brand/").replace(/^assets\/assets\//, "assets/").replace(/\.png$/, ".webp").replace(/\.svg$/, ".png");
const writeDataUrl = (dataUrl: string): Promise<string> => new Promise((resolve, reject) => {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const fs = wx.getFileSystemManager();
  const dir = `${wx.env.USER_DATA_PATH}/share`;
  try { fs.mkdirSync(dir, true); } catch { /* directory already exists */ }
  // 本地用户文件合计只有 200 MB（和数据库共用，见 storage.ts 的 saveFileDatabase），
  // 每分享一次留一张就会一直涨。分享面板一次只展示一张，旧的在画新图之前清掉。
  try {
    for (const name of fs.readdirSync(dir)) {
      try { fs.unlinkSync(`${dir}/${name}`); } catch { /* 已被删掉 */ }
    }
  } catch { /* 目录读不出来就不清，照常写 */ }
  const filePath = `${dir}/share-${Date.now()}-${++fileSequence}.png`;
  fs.writeFile({ filePath, data: base64, encoding: "base64", success: () => resolve(filePath), fail: reject });
});

// ⚠️ 不能走 document.createElement("canvas")：Taro 构建把源码里的裸 document 换成 @tarojs/runtime 的 TaroDocument，
// 它造出来的是没有 getContext 的 TaroElement（原来给 globalThis.document 打的补丁永远轮不到，2026-09-26）。直接造离屏画布。
const createOffscreenCanvas = () => {
    if (typeof wx.createOffscreenCanvas !== "function") throw new Error("当前微信基础库不支持离屏 Canvas 2D");
    const canvas = wx.createOffscreenCanvas({ type: "2d", width: 1, height: 1 });
    currentCanvas = canvas;
    canvas.toBlob = (callback: (blob: WeappShareBlob | null) => void) => {
      void writeDataUrl(canvas.toDataURL("image/png")).then((filePath) => {
        callback({ type: "image/png", size: 0, __wxFilePath: filePath, __wxDataUrl: filePath } as WeappShareBlob);
      }).catch(() => callback(null));
    };
    return canvas;
};

const installCanvas = () => {
  const ImageCtor = function(this: any) {
    if (!currentCanvas) throw new Error("请先创建分享画布");
    const image = currentCanvas.createImage();
    try { Object.defineProperty(image, "naturalWidth", { get: () => image.width }); } catch { /* native image already exposes equivalent dimensions */ }
    try { Object.defineProperty(image, "naturalHeight", { get: () => image.height }); } catch { /* native image already exposes equivalent dimensions */ }
    let prototype = Object.getPrototypeOf(image);
    let sourceDescriptor: PropertyDescriptor | undefined;
    while (prototype && !sourceDescriptor) {
      sourceDescriptor = Object.getOwnPropertyDescriptor(prototype, "src");
      prototype = Object.getPrototypeOf(prototype);
    }
    if (sourceDescriptor?.set) {
      let source = "";
      Object.defineProperty(image, "src", {
        configurable: true,
        get: () => source,
        set: (value: string) => {
          source = String(value);
          const path = `/${normalizeImagePath(source)}`;
          wx.getImageInfo({
            src: path,
            success: (result: { path: string }) => sourceDescriptor!.set!.call(image, result.path),
            fail: () => { image.onerror?.(new Error("分享图片素材无法读取")); }
          });
        }
      });
    }
    return image;
  } as any;
  (globalThis as any).Image = ImageCtor;
  // URL.createObjectURL 只有一份：browser-runtime.weapp.cjs，认 __wxDataUrl（分享图）也认备份导出的 Blob。
};
installCanvas();

export const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius); ctx.arcTo(x, y + h, x, y, radius); ctx.arcTo(x, y, x + w, y, radius); ctx.closePath();
};
export const loadImage = (src: string): Promise<HTMLImageElement | null> => new Promise((resolve) => {
  try {
    const image = new (globalThis as any).Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = normalizeImagePath(src);
  } catch { resolve(null); }
});
export const drawSticker = (ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, right: number, bottom: number, height: number) => {
  if (!image) return;
  const width = (image.naturalWidth / image.naturalHeight) * height;
  ctx.drawImage(image, right - width, bottom - height, width, height);
};
export const drawBackground = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const [x, y, r, rgb] of [[940, 160, 620, "126, 190, 79"], [80, HEIGHT - 80, 560, "232, 151, 28"]] as const) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r); glow.addColorStop(0, `rgba(${rgb}, 0.14)`); glow.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
};
export const drawCard = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill = CARD) => {
  ctx.save(); roundRectPath(ctx, x, y, w, h, 36); ctx.shadowColor = "rgba(60, 45, 30, 0.10)"; ctx.shadowBlur = 36; ctx.shadowOffsetY = 10; ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  if (fill === CARD) { roundRectPath(ctx, x, y, w, h, 36); ctx.strokeStyle = "rgba(60, 45, 30, 0.07)"; ctx.lineWidth = 2; ctx.stroke(); }
};
export const drawChip = (ctx: CanvasRenderingContext2D, x: number, y: number, label: string, fill: string, color: string) => {
  ctx.font = `700 28px ${FONT_SANS}`; const w = ctx.measureText(label).width + 52; roundRectPath(ctx, x, y, w, 58, 29); ctx.fillStyle = fill; ctx.fill(); ctx.fillStyle = color; ctx.textAlign = "left"; ctx.fillText(label, x + 26, y + 39); return w;
};
export const drawBigNumber = (ctx: CanvasRenderingContext2D, text: string, unit: string, x: number, baseline: number, maxWidth: number) => {
  let size = 200;
  for (; size > 96; size -= 8) { ctx.font = `800 ${size}px ${FONT_SANS}`; const numberWidth = ctx.measureText(text).width; ctx.font = `800 ${Math.round(size * 0.26)}px ${FONT_SANS}`; if (numberWidth + 18 + ctx.measureText(unit).width <= maxWidth) break; }
  ctx.textAlign = "left"; ctx.fillStyle = INK; ctx.font = `800 ${size}px ${FONT_SANS}`; ctx.fillText(text, x - 6, baseline); const numberWidth = ctx.measureText(text).width; ctx.fillStyle = INK2; ctx.font = `800 ${Math.round(size * 0.26)}px ${FONT_SANS}`; ctx.fillText(unit, x + numberWidth + 12, baseline - 6);
};
export const drawStatCards = (ctx: CanvasRenderingContext2D, top: number, items: Array<{ label: string; value: string }>) => {
  const gap = 24; const cardW = (INNER - gap * (items.length - 1)) / items.length;
  items.forEach((item, index) => { const x = MARGIN + index * (cardW + gap); drawCard(ctx, x, top, cardW, 150); ctx.textAlign = "left"; ctx.fillStyle = INK3; ctx.font = `700 26px ${FONT_SANS}`; ctx.fillText(item.label, x + 34, top + 56); ctx.fillStyle = INK; ctx.font = `800 44px ${FONT_SANS}`; ctx.fillText(item.value, x + 34, top + 116); });
};
export const drawBrandRow = async (ctx: CanvasRenderingContext2D, date: string, iconUrl: string) => {
  const size = 96; const y = 84; const icon = await loadImage(iconUrl);
  if (icon) { ctx.save(); roundRectPath(ctx, MARGIN, y, size, size, 26); ctx.clip(); ctx.drawImage(icon, MARGIN, y, size, size); ctx.restore(); }
  ctx.textAlign = "left"; ctx.fillStyle = INK; ctx.font = `800 46px ${FONT_SANS}`; ctx.fillText("收集日", MARGIN + size + 30, y + 50); ctx.fillStyle = INK3; ctx.font = `700 24px ${FONT_SANS}`; ctx.fillText("ShuShuGo · 每天收集一点日语", MARGIN + size + 30, y + 86);
  const weekdays = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"]; const label = `${date.replace(/-/g, ".")} · ${weekdays[new Date(`${date}T00:00:00`).getDay()]}`; ctx.font = `700 26px ${FONT_SANS}`; const chipW = ctx.measureText(label).width + 56; const chipX = WIDTH - MARGIN - chipW; roundRectPath(ctx, chipX, y + 20, chipW, 56, 28); ctx.fillStyle = INSET; ctx.fill(); ctx.fillStyle = INK2; ctx.fillText(label, chipX + 28, y + 57);
};
export const drawFooter = (ctx: CanvasRenderingContext2D, quote: string, note: string, signature: string) => {
  const top = 1362; roundRectPath(ctx, MARGIN, top, 8, 84, 4); ctx.fillStyle = PRIMARY; ctx.fill(); ctx.textAlign = "left"; ctx.fillStyle = INK; ctx.font = `600 38px ${FONT_SERIF}`; ctx.fillText(quote, MARGIN + 34, top + 38); ctx.fillStyle = INK3; ctx.font = `600 24px ${FONT_SANS}`; ctx.fillText(note, MARGIN + 38, top + 78); ctx.textAlign = "right"; ctx.fillText(signature, WIDTH - MARGIN, top + 78);
};
export const createShareCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
  const canvas = createOffscreenCanvas() as unknown as HTMLCanvasElement; canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null; if (!ctx) throw new Error("无法创建微信离屏画布");
  currentCanvas = canvas; return { canvas, ctx };
};
export const toPngBlob = async (canvas: HTMLCanvasElement): Promise<Blob> => {
  const dataUrl = (canvas as any).toDataURL("image/png");
  const filePath = await writeDataUrl(dataUrl);
  return { type: "image/png", size: 0, __wxFilePath: filePath, __wxDataUrl: filePath } as WeappShareBlob;
};
