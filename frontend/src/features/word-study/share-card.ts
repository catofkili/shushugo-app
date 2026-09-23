import { formatDuration, monthDays } from "./word-study-utils";
import {
  createShareCanvas, drawBackground, drawBigNumber, drawBrandRow, drawCard, drawChip, drawFooter, drawStatCards, drawSticker,
  FONT_SANS, GOLD, GOLD_INK, INK, INK3, INNER, loadImage, MARGIN, ON_PRIMARY, PRIMARY, PRIMARY_DEEP, PRIMARY_TINT, toPngBlob, WIDTH
} from "../../lib/share-canvas";
import { brandIconUrl, stickerUrl } from "../../components/CapybaraMascot";

// 打卡分享图:1080×1500,和 App 同一张浅纸 + 吉祥物(当天欢呼,破里程碑得意)。
// 纯 canvas 绘制,贴纸和图标是 public/brand 下的本地文件,离线可用。底座在 lib/share-canvas。

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

// 均为日语谚语(公有领域),按日期轮换。
const QUOTES = [
  { jp: "継続は力なり", zh: "坚持,本身就是力量。" },
  { jp: "千里の道も一歩から", zh: "千里之行,始于足下。" },
  { jp: "塵も積もれば山となる", zh: "积少成多,聚沙成塔。" },
  { jp: "七転び八起き", zh: "七倒八起,越挫越勇。" },
  { jp: "好きこそ物の上手なれ", zh: "唯有热爱,方能精进。" },
  { jp: "初心忘るべからず", zh: "莫忘初心。" }
];

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

/** 顶上那块浅绿大卡：今天背了几个词 + 徽章 + 右下角一只吉祥物 */
const drawHero = async (ctx: CanvasRenderingContext2D, todayWordCount: number, encoreWords: number, milestoneReached: number) => {
  const top = 232;
  const height = 380;
  drawCard(ctx, MARGIN, top, INNER, height, PRIMARY_TINT);
  const mascot = await loadImage(stickerUrl(milestoneReached > 0 ? "mood-proud" : "mood-yay"));
  const mascotHeight = 300;
  const mascotWidth = mascot ? (mascot.naturalWidth / mascot.naturalHeight) * mascotHeight : 0;
  drawSticker(ctx, mascot, WIDTH - MARGIN - 28, top + height - 14, mascotHeight);

  ctx.textAlign = "left";
  ctx.fillStyle = PRIMARY_DEEP;
  ctx.font = `800 32px ${FONT_SANS}`;
  ctx.fillText("今天背了", MARGIN + 56, top + 78);
  drawBigNumber(ctx, String(todayWordCount), "词", MARGIN + 56, top + 262, INNER - 112 - mascotWidth);

  // 徽章从数字下方向右排:里程碑(稀有,金色)在前,加餐在后
  let chipX = MARGIN + 56;
  if (milestoneReached > 0) chipX += drawChip(ctx, chipX, top + 290, `⚑ 累计破 ${milestoneReached}`, GOLD, GOLD_INK) + 14;
  if (encoreWords > 0) drawChip(ctx, chipX, top + 290, `✦ 加餐 +${encoreWords}`, PRIMARY, ON_PRIMARY);
};

const drawCalendar = (ctx: CanvasRenderingContext2D, input: ShareCardInput) => {
  const calendar = monthDays(input.studyDate);
  const top = 818;
  drawCard(ctx, MARGIN, top, INNER, 500);

  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `800 36px ${FONT_SANS}`;
  ctx.fillText(calendar.title, MARGIN + 46, top + 70);

  const checkedToday = input.checkins.has(input.studyDate);
  ctx.textAlign = "right";
  ctx.fillStyle = checkedToday ? PRIMARY_DEEP : INK3;
  ctx.font = `700 26px ${FONT_SANS}`;
  ctx.fillText(checkedToday ? "✓ 今日已打卡" : "今日未打卡", WIDTH - MARGIN - 46, top + 68);

  const gridLeft = MARGIN + 80;
  const gridPitch = (INNER - 160) / 6;
  ctx.textAlign = "center";
  ["日", "一", "二", "三", "四", "五", "六"].forEach((label, index) => {
    ctx.fillStyle = INK3;
    ctx.font = `700 24px ${FONT_SANS}`;
    ctx.fillText(label, gridLeft + index * gridPitch, top + 126);
  });

  const rowPitch = 56;
  const firstRowY = top + 180;
  calendar.cells.forEach((cell, index) => {
    if (!cell) return;
    const cx = gridLeft + (index % 7) * gridPitch;
    const cy = firstRowY + Math.floor(index / 7) * rowPitch;
    const checked = input.checkins.has(cell.date);
    if (checked) {
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fillStyle = PRIMARY;
      ctx.fill();
    }
    if (cell.date === input.studyDate) {
      ctx.beginPath();
      ctx.arc(cx, cy, 29, 0, Math.PI * 2);
      ctx.strokeStyle = PRIMARY_DEEP;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = checked ? ON_PRIMARY : INK3;
    ctx.font = `${checked ? 800 : 600} 24px ${FONT_SANS}`;
    ctx.fillText(String(cell.day), cx, cy + 9);
  });
};

export const renderShareCard = async (input: ShareCardInput): Promise<Blob> => {
  const { canvas, ctx } = createShareCanvas();
  const quote = QUOTES[new Date(`${input.studyDate}T00:00:00`).getDate() % QUOTES.length];

  drawBackground(ctx);
  await drawBrandRow(ctx, input.studyDate, brandIconUrl());
  await drawHero(ctx, input.todayWordCount, input.encoreWords ?? 0, input.milestoneReached ?? 0);
  drawStatCards(ctx, 640, [
    { label: "背词用时", value: formatDuration(input.totalSeconds) },
    { label: "连续打卡", value: `${streakDays(input.checkins, input.studyDate)} 天` },
    { label: "累计打卡", value: `${input.checkins.size} 天` }
  ]);
  drawCalendar(ctx, input);
  drawFooter(ctx, `「${quote.jp}」`, quote.zh, "今天也把日语往前推了一点。");

  return toPngBlob(canvas);
};
