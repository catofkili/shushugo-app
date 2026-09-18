import type { WeeklyReport } from "./analytics/weekly";

/**
 * 周报分享长图。
 *
 * 三条硬约束（改之前先读）：
 * ① **不带易错词明细、不带账号/邮箱/通知标识**。分享出去的是一张图，收图的人
 *    不该看到「你哪些词记不住」。计划里 P5 的选词只留在 App 内。
 * ② **视觉必须和页面一致**。配色取 `.weekly-report-page` 浅色那一套 `--wr-*`
 *    的实际值，版式也照着页面走（日期条、账本、柱状、模式条），否则分享图
 *    和用户刚看过的页面是两套东西。
 *    V2 更新：独立海报已取代浅色账本；以封面的梅紫、纸色、薄荷绿保持一致，
 *    分享图仍用静态分区方便保存与阅读，不能带入词语唱片墙明细。
 *    V3 更新：音乐符号已撤下，改为绿色纸景与书签，借鉴叙事方法而非音乐题材。
 * ③ **缺模块就省略，不凑数**。没有高光就不画那一块，时长不足一分钟就写
 *    「不足 1 分钟」，高度按实际内容算，不留一大片空白。
 *
 * 画布 1080 宽：微信里点开能看清，文件也不至于太大。
 */

export interface WeeklyReportShareImage {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

const WIDTH = 1080;
const MARGIN = 84;
const CONTENT_W = WIDTH - MARGIN * 2;
const SECTION_GAP = 44;

const FONT_SANS = '"Noto Sans SC", "Noto Sans JP", system-ui, sans-serif';
const FONT_SERIF = '"Shushu Echo", "Kaiti SC", "Hiragino Mincho ProN", serif';

/** 分享图正文沿用纸色对比；V2 封面与独立场景一致，改配色时两边一起检查。 */
const INK = "#302b3c";
const INK_SOFT = "#554e61";
const MUTED = "#766e7b";
const LINE = "#ded9d2";
const ACCENT = "#63517f";
const WARM = "#96643b";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

const font = (size: number, weight = 700, serif = false): string =>
  `${weight} ${size}px ${serif ? FONT_SERIF : FONT_SANS}`;

const roundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

const fillRounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string): void => {
  if (w <= 0 || h <= 0) return;
  roundedRect(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
};

/** 写一行字。会改 ctx 的 font/fillStyle，所以量宽度要用 measure()。 */
const text = (ctx: CanvasRenderingContext2D, value: string, x: number, y: number, f: string, color = INK, align: CanvasTextAlign = "left"): void => {
  ctx.font = f;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
  ctx.textAlign = "left";
};

/** 先设字体再量宽度。直接 measureText 会拿到上一次 text() 留下的字体。 */
const measure = (ctx: CanvasRenderingContext2D, value: string, f: string): number => {
  ctx.font = f;
  return ctx.measureText(value).width;
};

/** 逐字断行。中文日文都没有空格，按词断行在 canvas 里没有可靠依据。 */
const wrapLines = (ctx: CanvasRenderingContext2D, value: string, maxWidth: number, f: string): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const char of value) {
    const next = line + char;
    if (measure(ctx, next, f) > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
};

const blobFromCanvas = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成周报长图")), "image/png");
});

const weekdayOf = (date: string): string => {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "" : WEEKDAY_LABELS[parsed.getDay()];
};

const windowEndDate = (report: WeeklyReport): string => {
  const boundary = new Date(report.window.endAt);
  return `${boundary.getFullYear()}.${String(boundary.getMonth() + 1).padStart(2, "0")}.${String(boundary.getDate()).padStart(2, "0")}`;
};

/** 基于已保存的同一份快照出图，不重新查库；按所有实际文字量高度，长高光不能截断。 */
export async function renderWeeklyReportShareImage(report: WeeklyReport): Promise<WeeklyReportShareImage> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前设备不支持周报长图");

  const { metrics, highlight } = report;
  const headline = "一页一日，慢慢成林。";
  const quoteFont = font(34, 500, true);
  const quoteLines = highlight ? wrapLines(ctx, highlight.text, CONTENT_W - 80, quoteFont) : [];
  const quoteHeight = highlight ? 144 + quoteLines.length * 54 : 0;
  const headerHeight = report.keyword ? 370 : 314;
  const modes = [
    {label:"单词",count:metrics.wordReviews,color:ACCENT},
    {label:"语法",count:metrics.grammarReviews,color:"#527565"},
    {label:"汉字读音",count:metrics.kanjiReviews,color:WARM}
  ];
  const height = MARGIN * 2 + headerHeight + 234 + 358 + 290 + quoteHeight + (highlight ? SECTION_GAP : 0) + 170 + SECTION_GAP * 4;
  canvas.height = height;
  ctx.fillStyle = "#faf8f3";
  ctx.fillRect(0, 0, WIDTH, height);

  // 封面与屏幕采用相同的紫色书封；分享仍不带账号与易错词。
  fillRounded(ctx, 40, 40, WIDTH - 80, headerHeight, 26, "#263e35");
  ctx.save();
  roundedRect(ctx, 40, 40, WIDTH - 80, headerHeight, 26);
  ctx.clip();
  // 折叠纸页与主页纸叶入口对应，装饰不带任何易错词数据。
  ctx.translate(WIDTH - 160, 240);
  ctx.rotate(.18);
  ctx.fillStyle = "#acb79a"; ctx.fillRect(-95,-160,220,350);
  ctx.rotate(-.1);
  ctx.fillStyle = "#d8d2b9"; ctx.fillRect(-110,-155,220,340);
  ctx.fillStyle = "#8b9c7b";
  ctx.beginPath(); ctx.moveTo(-50,-170);ctx.lineTo(5,-170);ctx.lineTo(5,-55);ctx.lineTo(-22,-73);ctx.lineTo(-50,-55);ctx.fill();
  ctx.restore();
  text(ctx, "2F  /  字间小院", MARGIN, 110, font(25, 500), "#cbd5c3");
  text(ctx, "SHUSHUGO", WIDTH - MARGIN, 110, font(23, 500), "#cbd5c3", "right");
  text(ctx, headline, MARGIN, 208, font(62, 500, true), "#fff1d6");
  text(ctx, `${report.window.start.replace(/-/g, ".")} 14:00 — ${windowEndDate(report)} 14:00`, MARGIN, 272, font(23, 400), "#cbd5c3");
  if (report.keyword) {
    const keywordFont = font(27, 500);
    const keywordLines = wrapLines(ctx, report.keyword.keyword, CONTENT_W - 175, keywordFont);
    // 关键词属于短标题；极长历史文案缩小到单行，正文高光另按实际高度展开。
    const label = "本周关键词";
    text(ctx, label, MARGIN, 339, font(20, 400), "#cbd5c3");
    const size = keywordLines.length > 1 ? Math.max(14, Math.floor(27 * (CONTENT_W - 175) / measure(ctx, report.keyword.keyword, keywordFont))) : 27;
    text(ctx, report.keyword.keyword, MARGIN + 154, 339, font(size, 500), "#fff1d6");
  }
  let y = headerHeight + 40 + SECTION_GAP;
  const summaries = [
    ["学习日", String(metrics.days), "天"],
    ["学习时光", metrics.totalSeconds < 60 ? "不足 1" : String(metrics.minutes), "分钟"],
    ["首次练习的单词", String(metrics.newWords), "个"]
  ];
  const columnWidth = CONTENT_W / 3;
  summaries.forEach(([label, value, unit], index) => {
    const x = MARGIN + index * columnWidth;
    text(ctx, label, x, y + 30, font(23, 400), MUTED);
    const valueFont = font(62, 500);
    text(ctx, value, x, y + 119, valueFont, ACCENT);
    text(ctx, unit, x + measure(ctx, value, valueFont) + 12, y + 119, font(22, 400), MUTED);
  });
  ctx.fillStyle = LINE; ctx.fillRect(MARGIN, y + 156, CONTENT_W, 1);
  y += 234;

  text(ctx, "一周的学习节奏", MARGIN, y + 30, font(30, 500, true));
  text(ctx, `${metrics.totalReviews.toLocaleString("zh-CN")} 次作答`, WIDTH - MARGIN, y + 30, font(23, 400), MUTED, "right");
  const maxReviews = Math.max(1, ...metrics.daily.map((day) => day.reviews));
  const columns = Math.max(1, metrics.daily.length);
  const gap = 22;
  const barWidth = (CONTENT_W - gap * (columns - 1)) / columns;
  metrics.daily.forEach((day, index) => {
    const x = MARGIN + index * (barWidth + gap);
    text(ctx, String(day.reviews), x + barWidth / 2, y + 83, font(23, 400), MUTED, "center");
    fillRounded(ctx, x, y + 104, barWidth, 150, 8, "#f1eee7");
    const barHeight = day.reviews / maxReviews * 150;
    fillRounded(ctx, x, y + 254 - barHeight, barWidth, barHeight, 8, day.reviews === maxReviews ? ACCENT : "#b7a9c9");
    text(ctx, weekdayOf(day.date), x + barWidth / 2, y + 292, font(22, 400), MUTED, "center");
  });
  text(ctx, "日包含首尾两个周日的半天。全部学习模式均计入。", MARGIN, y + 340, font(20, 400), MUTED);
  y += 358 + SECTION_GAP;

  text(ctx, "每一种相遇，都算数。", MARGIN, y + 30, font(30, 500, true));
  const maxMode = Math.max(1, ...modes.map(mode => mode.count));
  modes.forEach((mode, index) => {
    const baseline = y + 100 + index * 72;
    text(ctx, mode.label, MARGIN, baseline, font(25, 400), INK_SOFT);
    fillRounded(ctx, MARGIN + 158, baseline - 15, CONTENT_W - 305, 10, 5, "#f1eee7");
    fillRounded(ctx, MARGIN + 158, baseline - 15, (CONTENT_W - 305) * mode.count / maxMode, 10, 5, mode.color);
    text(ctx, `${mode.count.toLocaleString("zh-CN")} 次`, WIDTH - MARGIN, baseline, font(25, 400), INK_SOFT, "right");
  });
  y += 290 + SECTION_GAP;

  if (highlight) {
    fillRounded(ctx, MARGIN - 20, y, CONTENT_W + 40, quoteHeight, 20, "#f5e9d7");
    text(ctx, "一个值得留下的瞬间", MARGIN + 20, y + 52, font(23, 400), WARM);
    quoteLines.forEach((line, index) => text(ctx, line, MARGIN + 20, y + 111 + index * 54, quoteFont));
    y += quoteHeight + SECTION_GAP;
  }
  ctx.fillStyle = LINE; ctx.fillRect(MARGIN, y, CONTENT_W, 1);
  text(ctx, `截至这一周，${metrics.cumulativeDays} 个学习日 · ${metrics.cumulativeWords} 个首次练习过的词`, MARGIN, y + 57, font(25, 400), INK_SOFT);
  text(ctx, "ShuShuGo · 收集日", MARGIN, y + 119, font(23, 500), ACCENT);
  text(ctx, "每一次相遇，都算数。", WIDTH - MARGIN, y + 119, font(23, 400), MUTED, "right");
  const blob = await blobFromCanvas(canvas);
  return { blob, dataUrl: canvas.toDataURL("image/png"), width: WIDTH, height };
}
