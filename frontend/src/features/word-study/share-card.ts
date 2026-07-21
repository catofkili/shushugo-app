import { formatDuration, monthDays } from "./word-study-utils";

// 打卡分享图:1080×1500 深色卡片,与 App 内主题(炭黑 + 薄荷绿)一致。
// 纯 canvas 绘制,不依赖外部资源,离线可用。

export interface ShareCardInput {
  studyDate: string;
  todayWordCount: number;
  totalSeconds: number;
  checkins: Set<string>;
  /** 今日加餐词数,>0 时在主数字旁加一枚星徽 */
  encoreWords?: number;
  /** 今天冲破的累计里程碑(如 1000),破千当天的高光徽章 */
  milestoneReached?: number;
}

const WIDTH = 1080;
const HEIGHT = 1500;
const MARGIN = 84;
const MINT = "#81D8CF";
const INK = "#17423C";

const FONT_SANS = '-apple-system, "PingFang SC", "Hiragino Sans", system-ui, sans-serif';
const FONT_SERIF = '"Hiragino Mincho ProN", "Songti SC", serif';

// 均为日语谚语(公有领域),按日期轮换。
const QUOTES = [
  { jp: "継続は力なり", zh: "坚持,本身就是力量。" },
  { jp: "千里の道も一歩から", zh: "千里之行,始于足下。" },
  { jp: "塵も積もれば山となる", zh: "积少成多,聚沙成塔。" },
  { jp: "七転び八起き", zh: "七倒八起,越挫越勇。" },
  { jp: "好きこそ物の上手なれ", zh: "唯有热爱,方能精进。" },
  { jp: "初心忘るべからず", zh: "莫忘初心。" }
];

const WEEKDAYS_JP = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

const shiftDate = (date: string, days: number) => {
  const base = new Date(`${date}T00:00:00`);
  base.setDate(base.getDate() + days);
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const day = String(base.getDate()).padStart(2, "0");
  return `${base.getFullYear()}-${month}-${day}`;
};

// 以学习日为终点的连续打卡天数;当天没打卡就从昨天往回数。
export const streakDays = (checkins: Set<string>, studyDate: string) => {
  let cursor = checkins.has(studyDate) ? studyDate : shiftDate(studyDate, -1);
  let streak = 0;
  while (checkins.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
};

const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

const drawBackground = (ctx: CanvasRenderingContext2D) => {
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, "#1D2221");
  bg.addColorStop(1, "#252B2A");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(920, 120, 0, 920, 120, 560);
  glow.addColorStop(0, "rgba(129, 216, 207, 0.13)");
  glow.addColorStop(1, "rgba(129, 216, 207, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, 700);

  // 大字水印
  ctx.save();
  ctx.fillStyle = "rgba(129, 216, 207, 0.05)";
  ctx.font = `500 560px ${FONT_SERIF}`;
  ctx.textAlign = "right";
  ctx.fillText("語", WIDTH + 110, 660);
  ctx.restore();

  // 底部青海波式细弧
  ctx.save();
  ctx.strokeStyle = "rgba(129, 216, 207, 0.07)";
  ctx.lineWidth = 2;
  for (let ring = 0; ring < 4; ring += 1) {
    ctx.beginPath();
    ctx.arc(60, HEIGHT + 40, 130 + ring * 44, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
};

const drawBrandRow = (ctx: CanvasRenderingContext2D, studyDate: string) => {
  const tileSize = 96;
  const tileY = 92;
  const tile = ctx.createLinearGradient(MARGIN, tileY, MARGIN + tileSize, tileY + tileSize);
  tile.addColorStop(0, "#9AE2DA");
  tile.addColorStop(1, "#6CC9BF");
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
  ctx.fillText("Master Nihongo", MARGIN + tileSize + 34, tileY + 44);
  ctx.fillStyle = "rgba(129, 216, 207, 0.62)";
  ctx.font = `700 22px ${FONT_SANS}`;
  const subtitle = "V O C A B U L A R Y ・ G R A M M A R";
  ctx.fillText(subtitle, MARGIN + tileSize + 34, tileY + 84);

  // 日期胶囊(右对齐)
  const weekday = WEEKDAYS_JP[new Date(`${studyDate}T00:00:00`).getDay()];
  const label = `${studyDate} · ${weekday}`;
  ctx.font = `600 26px ${FONT_SANS}`;
  const textWidth = ctx.measureText(label).width;
  const chipW = textWidth + 56;
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

const drawHero = (ctx: CanvasRenderingContext2D, todayWordCount: number, encoreWords: number, milestoneReached: number) => {
  ctx.textAlign = "left";
  ctx.fillStyle = MINT;
  ctx.font = `700 30px ${FONT_SANS}`;
  ctx.fillText("今日背诵", MARGIN, 336);

  ctx.fillStyle = "#F4FAF9";
  ctx.font = `800 168px ${FONT_SANS}`;
  const numberText = String(todayWordCount);
  ctx.fillText(numberText, MARGIN - 6, 484);
  const numberWidth = ctx.measureText(numberText).width;
  ctx.fillStyle = "rgba(244, 250, 249, 0.55)";
  ctx.font = `700 46px ${FONT_SANS}`;
  ctx.fillText("词", MARGIN + numberWidth + 22, 480);

  // 数字下的强调短线
  roundRectPath(ctx, MARGIN, 508, 132, 10, 5);
  ctx.fillStyle = MINT;
  ctx.fill();

  // 徽章从数字右侧向右排:里程碑(稀有,金色)在前,加餐星徽在后
  let chipX = MARGIN + numberWidth + 96;
  if (milestoneReached > 0) {
    const label = `⚑ 累计破 ${milestoneReached}`;
    ctx.font = `700 28px ${FONT_SANS}`;
    const labelWidth = ctx.measureText(label).width;
    const chipW = labelWidth + 52;
    roundRectPath(ctx, chipX, 402, chipW, 58, 29);
    ctx.fillStyle = "#F5C15C";
    ctx.fill();
    ctx.fillStyle = "#4A3407";
    ctx.fillText(label, chipX + 26, 441);
    chipX += chipW + 18;
  }
  if (encoreWords > 0) {
    const label = `✦ 加餐 +${encoreWords}`;
    ctx.font = `700 28px ${FONT_SANS}`;
    const labelWidth = ctx.measureText(label).width;
    const chipW = labelWidth + 52;
    roundRectPath(ctx, chipX, 402, chipW, 58, 29);
    ctx.fillStyle = MINT;
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillText(label, chipX + 26, 441);
  }
};

const drawStatCards = (ctx: CanvasRenderingContext2D, input: ShareCardInput) => {
  const items = [
    { label: "背词用时", value: formatDuration(input.totalSeconds) },
    { label: "连续打卡", value: `${streakDays(input.checkins, input.studyDate)} 天` },
    { label: "累计打卡", value: `${input.checkins.size} 天` }
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

const drawCalendar = (ctx: CanvasRenderingContext2D, input: ShareCardInput) => {
  const calendar = monthDays(input.studyDate);
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
  ctx.fillText(calendar.title, MARGIN + 46, top + 70);

  const checkedToday = input.checkins.has(input.studyDate);
  ctx.textAlign = "right";
  ctx.fillStyle = checkedToday ? MINT : "rgba(244, 250, 249, 0.45)";
  ctx.font = `700 26px ${FONT_SANS}`;
  ctx.fillText(checkedToday ? "✓ 今日已打卡" : "今日未打卡", WIDTH - MARGIN - 46, top + 68);

  const gridLeft = MARGIN + 70;
  const gridPitch = (WIDTH - MARGIN * 2 - 140) / 6;
  ctx.textAlign = "center";
  ["日", "一", "二", "三", "四", "五", "六"].forEach((label, index) => {
    ctx.fillStyle = "rgba(244, 250, 249, 0.4)";
    ctx.font = `700 24px ${FONT_SANS}`;
    ctx.fillText(label, gridLeft + index * gridPitch, top + 136);
  });

  const rowPitch = 58;
  const firstRowY = top + 196;
  calendar.cells.forEach((cell, index) => {
    if (!cell) return;
    const cx = gridLeft + (index % 7) * gridPitch;
    const cy = firstRowY + Math.floor(index / 7) * rowPitch;
    const checked = input.checkins.has(cell.date);
    const isToday = cell.date === input.studyDate;
    if (checked) {
      ctx.beginPath();
      ctx.arc(cx, cy, 25, 0, Math.PI * 2);
      ctx.fillStyle = MINT;
      ctx.fill();
    }
    if (isToday) {
      ctx.beginPath();
      ctx.arc(cx, cy, 29, 0, Math.PI * 2);
      ctx.strokeStyle = MINT;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = checked ? INK : "rgba(244, 250, 249, 0.55)";
    ctx.font = `${checked ? 800 : 600} 24px ${FONT_SANS}`;
    ctx.fillText(String(cell.day), cx, cy + 9);
  });
};

const drawQuoteAndFooter = (ctx: CanvasRenderingContext2D, studyDate: string) => {
  const quote = QUOTES[new Date(`${studyDate}T00:00:00`).getDate() % QUOTES.length];
  roundRectPath(ctx, MARGIN, 1330, 8, 84, 4);
  ctx.fillStyle = MINT;
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#F4FAF9";
  ctx.font = `600 40px ${FONT_SERIF}`;
  ctx.fillText(`「${quote.jp}」`, MARGIN + 38, 1368);
  ctx.fillStyle = "rgba(244, 250, 249, 0.5)";
  ctx.font = `600 26px ${FONT_SANS}`;
  ctx.fillText(quote.zh, MARGIN + 42, 1410);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(244, 250, 249, 0.35)";
  ctx.font = `600 24px ${FONT_SANS}`;
  ctx.fillText("今天也把日语往前推了一点。", WIDTH - MARGIN, 1410);
};

export const renderShareCard = async (input: ShareCardInput): Promise<Blob> => {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");

  drawBackground(ctx);
  drawBrandRow(ctx, input.studyDate);
  drawHero(ctx, input.todayWordCount, input.encoreWords ?? 0, input.milestoneReached ?? 0);
  drawStatCards(ctx, input);
  drawCalendar(ctx, input);
  drawQuoteAndFooter(ctx, input.studyDate);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("图片导出失败");
  return blob;
};
