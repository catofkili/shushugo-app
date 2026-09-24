import type { WeeklyReport } from "../../lib/analytics/weekly";
import { brandIconUrl, stickerUrl } from "../../components/CapybaraMascot";
import { FONT_SANS, loadImage, roundRectPath, toPngBlob } from "../../lib/share-canvas";
import { KEYWORD_NOTES, dottedRange, shortDate } from "./variants";

/**
 * 周报两套新版式（星图 / 放映厅）的分享长图。1080×1920 竖图：朋友圈和聊天里点开都是整屏。
 *
 * 和 V3 长图（lib/weekly-report-share.ts）守同三条：
 * ① **不带「没记住的词」明细**（收图的人不该看到你哪些词记不住），也不带账号信息；
 * ② 视觉跟着页面走：星图是同一片夜空 + 北斗，放映厅是同一卷胶片 + 海报 + 「完」字章；
 * ③ 缺模块就省略（没关键词不画海报、没高光不画那一行），版面按实际内容往下排。
 * 图上用第一人称「我」：这张图是用户发出去的，页面里对用户说「你」。
 * 配色写死不读 CSS 变量 —— 图离开 App 就没有主题可跟了。
 */
const W = 1080;
const H = 1920;
const SERIF = '"Songti SC", "STSong", "Noto Serif SC", serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const num = (value: number) => value.toLocaleString("zh-CN");
const weekdayOf = (date: string) => WEEKDAY[new Date(`${date}T12:00:00`).getDay()] ?? "";

const mulberry = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const makeCanvas = () => {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 不可用");
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
};

const center = (ctx: CanvasRenderingContext2D, text: string, y: number, font: string, color: string | CanvasGradient) => {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = "center"; ctx.fillText(text, W / 2, y); ctx.textAlign = "left";
};

/** 一行里几段不同字号 / 颜色的字，整体居中（「我点亮了 7 颗星」这种） */
const centerRuns = (ctx: CanvasRenderingContext2D, runs: { text: string; font: string; color: string }[], y: number) => {
  const widths = runs.map((run) => { ctx.font = run.font; return ctx.measureText(run.text).width; });
  let x = (W - widths.reduce((a, b) => a + b, 0)) / 2;
  runs.forEach((run, i) => { ctx.font = run.font; ctx.fillStyle = run.color; ctx.textAlign = "left"; ctx.fillText(run.text, x, y); x += widths[i]; });
};

const glow = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
};

/** 贴纸按高度画、左下角对齐 */
const drawImageAt = (ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, x: number, bottom: number, height: number) => {
  if (!image) return 0;
  const width = (image.naturalWidth / image.naturalHeight) * height;
  ctx.drawImage(image, x, bottom - height, width, height);
  return width;
};

const brandRow = async (ctx: CanvasRenderingContext2D, y: number, color: string, muted: string) => {
  const icon = await loadImage(brandIconUrl());
  const size = 56;
  const label = "收集日 ShuShuGo";
  ctx.font = `800 30px ${FONT_SANS}`;
  const total = size + 16 + ctx.measureText(label).width;
  const x = (W - total) / 2;
  if (icon) {
    ctx.save(); roundRectPath(ctx, x, y - size + 10, size, size, 14); ctx.clip(); ctx.drawImage(icon, x, y - size + 10, size, size); ctx.restore();
  }
  ctx.fillStyle = color; ctx.fillText(label, x + size + 16, y);
  center(ctx, "日语，一天收集一点", y + 44, `500 24px ${FONT_SANS}`, muted);
};

/* ———————————————————————— 星图 ———————————————————————— */

const DIPPER = [[28, 44], [40, 104], [104, 116], [116, 60], [172, 52], [220, 58], [290, 100]] as const;
const DIPPER_LINKS = [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] as const;

export async function renderStarShare(report: WeeklyReport): Promise<Blob> {
  const { canvas, ctx } = makeCanvas();
  const { metrics, keyword, highlight } = report;
  const GOLD = "#ffd88a"; const FG = "#f4efff"; const MUTED = "#aab0d6";

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0a0f2c"); sky.addColorStop(0.55, "#150b2e"); sky.addColorStop(1, "#05071a");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  glow(ctx, 240, 420, 520, "rgba(90,60,170,0.45)");
  glow(ctx, 900, 1320, 560, "rgba(20,80,140,0.42)");
  glow(ctx, 760, 260, 320, "rgba(130,50,130,0.25)");
  const rand = mulberry(hash(`${report.window.start}:share`));
  for (let i = 0; i < 340; i += 1) {
    const x = rand() * W; const y = rand() * H; const r = 0.6 + rand() ** 3 * 2.8;
    if (r > 2.2) glow(ctx, x, y, r * 5, "rgba(235,238,255,0.35)");
    ctx.fillStyle = rand() < 0.2 ? `rgba(255,222,170,${0.5 + rand() * 0.5})` : `rgba(235,238,255,${0.45 + rand() * 0.55})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  center(ctx, "收集日 · 本周星图", 150, `800 34px ${FONT_SANS}`, GOLD);
  center(ctx, dottedRange(report.window), 205, `600 34px ${FONT_SANS}`, MUTED);
  center(ctx, "这一周", 330, `900 92px ${FONT_SANS}`, FG);
  centerRuns(ctx, [
    { text: "我点亮了 ", font: `900 92px ${FONT_SANS}`, color: FG },
    { text: String(metrics.days), font: `900 140px ${FONT_SANS}`, color: GOLD },
    { text: " 颗星", font: `900 92px ${FONT_SANS}`, color: FG }
  ], 470);

  // 北斗七星：和页面同一套坐标，放大 2.8 倍
  const scale = 2.8; const ox = (W - 320 * scale) / 2 + 10; const oy = 540;
  const peak = Math.max(1, ...metrics.daily.map((day) => day.reviews));
  const lit = (i: number) => (metrics.daily[i]?.reviews ?? 0) > 0 || (metrics.daily[i]?.seconds ?? 0) > 0;
  const P = (i: number) => [ox + DIPPER[i][0] * scale, oy + DIPPER[i][1] * scale] as const;
  for (const [a, b] of DIPPER_LINKS) {
    const [x1, y1] = P(a); const [x2, y2] = P(b);
    ctx.strokeStyle = lit(a) && lit(b) ? "rgba(255,216,138,0.7)" : "rgba(244,239,255,0.18)";
    ctx.lineWidth = lit(a) && lit(b) ? 4 : 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  DIPPER.forEach((_, i) => {
    const [x, y] = P(i);
    const reviews = metrics.daily[i]?.reviews ?? 0;
    const r = lit(i) ? (3.5 + 4.5 * Math.sqrt(reviews / peak)) * scale * 0.8 : 5;
    if (lit(i)) glow(ctx, x, y, r * 4, "rgba(255,216,138,0.55)");
    ctx.fillStyle = lit(i) ? "#fff6de" : "rgba(244,239,255,0.35)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.font = `800 30px ${FONT_SANS}`; ctx.fillStyle = lit(i) ? GOLD : MUTED; ctx.textAlign = "center";
    ctx.fillText(weekdayOf(metrics.daily[i]?.date ?? ""), x, [0, 3, 4, 5].includes(i) ? y - r - 22 : y + r + 46);
    ctx.textAlign = "left";
  });

  // 三个数。⚠️ 纵向预算（1920 高）：标题到 470、北斗到 ~920、三个数 950–1120、关键词 1200–1450、
  // 高光一行、底部月亮 + 水豚从 ~1560 起。加东西要先挪预算，第一版关键词和高光就压到了月亮上。
  let y = 950;
  const stats = [
    { value: metrics.totalSeconds < 60 ? "不足 1" : num(metrics.minutes), label: "分钟" },
    { value: num(metrics.totalReviews), label: "次作答" },
    { value: num(metrics.newWords), label: "个新词" }
  ];
  const cw = 290; const gap = 24; const sx = (W - cw * 3 - gap * 2) / 2;
  stats.forEach((stat, i) => {
    const x = sx + i * (cw + gap);
    roundRectPath(ctx, x, y, cw, 170, 28); ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = "center";
    ctx.font = `900 ${stat.value.length > 6 ? 52 : 64}px ${FONT_SANS}`; ctx.fillStyle = FG; ctx.fillText(stat.value, x + cw / 2, y + 92);
    ctx.font = `700 28px ${FONT_SANS}`; ctx.fillStyle = MUTED; ctx.fillText(stat.label, x + cw / 2, y + 140);
    ctx.textAlign = "left";
  });
  y += 170 + 80;

  if (keyword) {
    center(ctx, "这一周，我是", y, `600 36px ${FONT_SANS}`, MUTED);
    const shimmer = ctx.createLinearGradient(W / 2 - 300, 0, W / 2 + 300, 0);
    shimmer.addColorStop(0, "#ffd88a"); shimmer.addColorStop(0.35, "#ffffff"); shimmer.addColorStop(0.65, "#c9b6ff"); shimmer.addColorStop(1, "#8ff0dc");
    ctx.save(); ctx.shadowColor = "rgba(255,216,138,0.55)"; ctx.shadowBlur = 40;
    center(ctx, keyword.keyword, y + 140, `900 128px ${FONT_SANS}`, shimmer);
    ctx.restore();
    const note = KEYWORD_NOTES[keyword.keyword];
    if (note) center(ctx, note, y + 200, `500 32px ${FONT_SANS}`, "rgba(244,239,255,0.82)");
    y += 270;
  }
  if (highlight) {
    const best = metrics.daily.find((day) => day.date === highlight.date);
    center(ctx, `最亮的一天　${shortDate(highlight.date)} 周${weekdayOf(highlight.date)} · ${num(best?.reviews ?? 0)} 次`, y, `700 34px ${FONT_SANS}`, "#a8dcff");
    y += 70;
  }

  // 底部：月亮 + 睡着的水豚 + 累计
  const bottom = H - 190;
  // 月牙：整圆减去偏移的圆（evenodd 裁切），不用「盖一个底色圆」—— 渐变底色上盖不严，会露一圈边
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(322, bottom - 184, 36, 0, Math.PI * 2); ctx.clip("evenodd");
  ctx.shadowColor = "rgba(255,242,196,0.6)"; ctx.shadowBlur = 30; ctx.fillStyle = "#fff2c4";
  ctx.beginPath(); ctx.arc(302, bottom - 172, 40, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  drawImageAt(ctx, await loadImage(stickerUrl("mood-sleep")), 70, bottom, 160);
  ctx.textAlign = "right";
  ctx.font = `600 30px ${FONT_SANS}`; ctx.fillStyle = MUTED; ctx.fillText(`累计 ${num(metrics.cumulativeDays)} 个学习日`, W - 90, bottom - 110);
  ctx.font = `900 64px ${FONT_SANS}`; ctx.fillStyle = FG; ctx.fillText(`${num(metrics.cumulativeWords)} 个词`, W - 90, bottom - 40);
  ctx.textAlign = "left";
  await brandRow(ctx, H - 110, FG, MUTED);
  return toPngBlob(canvas);
}

/* ———————————————————————— 放映厅 ———————————————————————— */

export async function renderFilmShare(report: WeeklyReport): Promise<Blob> {
  const { canvas, ctx } = makeCanvas();
  const { metrics, keyword, highlight } = report;
  const AMBER = "#ebb54e"; const FG = "#f4e8d4"; const MUTED = "#a89a84";

  ctx.fillStyle = "#0c0a08"; ctx.fillRect(0, 0, W, H);
  glow(ctx, 960, 180, 620, "rgba(255,138,60,0.22)");
  glow(ctx, 80, 1700, 560, "rgba(255,138,60,0.14)");
  // 两侧齿孔
  for (const x of [0, W - 46]) {
    ctx.fillStyle = "#000"; ctx.fillRect(x, 0, 46, H);
    ctx.fillStyle = "rgba(244,232,212,0.16)";
    for (let y = 18; y < H; y += 58) { roundRectPath(ctx, x + 12, y, 22, 32, 5); ctx.fill(); }
  }
  // 颗粒
  const rand = mulberry(hash(`${report.window.start}:film`));
  for (let i = 0; i < 4200; i += 1) {
    ctx.fillStyle = `rgba(255,240,220,${rand() * 0.06})`;
    ctx.fillRect(rand() * W, rand() * H, 2, 2);
  }

  // ⚠️ 纵向预算（1920 高）：片名到 ~400、时间码 ~620、胶片 680–910、海报 1030–1310、高光一行 ~1420、
  // 底部场记 + 累计 +「完」从 ~1580 起。加东西先挪预算 —— 第一版高光那一行压到了底部的场记上。
  center(ctx, "收集日 出品", 140, `700 34px ${FONT_SANS}`, AMBER);
  const gold = ctx.createLinearGradient(0, 190, 0, 300);
  gold.addColorStop(0, "#fff6e3"); gold.addColorStop(0.7, "#ebb54e"); gold.addColorStop(1, "#b9822c");
  center(ctx, "《我和日语的这一周》", 270, `900 84px ${SERIF}`, gold);
  center(ctx, dottedRange(report.window), 332, `500 32px ${FONT_SANS}`, MUTED);
  center(ctx, `主演　我　·　出场 ${metrics.days} 天`, 398, `800 38px ${SERIF}`, FG);

  // 时间码 + 七格胶片
  center(ctx, "片　长", 490, `600 28px ${FONT_SANS}`, MUTED);
  const s = Math.max(0, Math.round(metrics.totalSeconds));
  const code = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((part) => String(part).padStart(2, "0")).join(":");
  ctx.save(); ctx.shadowColor = "rgba(235,181,78,0.6)"; ctx.shadowBlur = 36;
  center(ctx, code, 620, `700 140px ${MONO}`, AMBER);
  ctx.restore();
  // 量字宽要先设回大字号：上面 restore() 把字体也还原了，拿小字号量的话红点会跑到时间码中间
  ctx.font = `700 140px ${MONO}`;
  ctx.fillStyle = "#ff4b3e"; ctx.beginPath(); ctx.arc(W / 2 - ctx.measureText(code).width / 2 - 30, 575, 12, 0, Math.PI * 2); ctx.fill();

  const sx = 110; const sw = W - 220; let y = 680; const sh = 230;
  roundRectPath(ctx, sx, y, sw, sh, 14); ctx.fillStyle = "#000"; ctx.fill();
  ctx.fillStyle = "rgba(244,232,212,0.18)";
  for (let x = sx + 20; x < sx + sw - 20; x += 40) { roundRectPath(ctx, x, y + 10, 22, 14, 4); ctx.fill(); roundRectPath(ctx, x, y + sh - 24, 22, 14, 4); ctx.fill(); }
  const peak = Math.max(1, ...metrics.daily.map((day) => day.reviews));
  const fw = (sw - 40 - 6 * 10) / 7;
  metrics.daily.forEach((day, i) => {
    const fx = sx + 20 + i * (fw + 10); const fy = y + 36; const fh = sh - 72;
    roundRectPath(ctx, fx, fy, fw, fh, 6); ctx.fillStyle = "rgba(244,232,212,0.06)"; ctx.fill();
    const bh = fh * (day.reviews / peak);
    if (bh > 0) {
      const bar = ctx.createLinearGradient(0, fy + fh - bh, 0, fy + fh);
      bar.addColorStop(0, day.reviews === peak ? "rgba(235,181,78,0.55)" : "rgba(235,181,78,0.2)"); bar.addColorStop(1, day.reviews === peak ? "#ebb54e" : "rgba(235,181,78,0.6)");
      roundRectPath(ctx, fx, fy + fh - bh, fw, bh, 6); ctx.fillStyle = bar; ctx.fill();
    }
    ctx.textAlign = "center";
    ctx.font = `800 26px ${FONT_SANS}`; ctx.fillStyle = FG; ctx.fillText(num(day.reviews), fx + fw / 2, fy + fh - 40);
    ctx.font = `700 24px ${FONT_SANS}`; ctx.fillStyle = day.reviews === peak ? "#1a1208" : MUTED; ctx.fillText(weekdayOf(day.date), fx + fw / 2, fy + fh - 10);
    ctx.textAlign = "left";
  });
  y += sh + 70;
  centerRuns(ctx, [
    { text: "拍下 ", font: `600 34px ${FONT_SANS}`, color: FG },
    { text: num(metrics.totalReviews), font: `900 40px ${FONT_SANS}`, color: AMBER },
    { text: " 个镜头 · 新面孔 ", font: `600 34px ${FONT_SANS}`, color: FG },
    { text: num(metrics.newWords), font: `900 40px ${FONT_SANS}`, color: AMBER },
    { text: " 位", font: `600 34px ${FONT_SANS}`, color: FG }
  ], y);
  y += 50;

  if (keyword) {
    const pw = 720; const ph = 280; const px = (W - pw) / 2;
    const red = ctx.createRadialGradient(W / 2, y + 60, 40, W / 2, y + 120, 520);
    red.addColorStop(0, "#8a1d1d"); red.addColorStop(1, "#3a0909");
    roundRectPath(ctx, px, y, pw, ph, 12); ctx.fillStyle = red; ctx.fill();
    roundRectPath(ctx, px + 16, y + 16, pw - 32, ph - 32, 6); ctx.strokeStyle = "rgba(255,208,122,0.5)"; ctx.lineWidth = 2; ctx.stroke();
    center(ctx, "本周主演　我　饰", y + 70, `700 28px ${FONT_SANS}`, "rgba(255,208,122,0.85)");
    ctx.save(); ctx.shadowColor = "rgba(255,208,122,0.5)"; ctx.shadowBlur = 24;
    center(ctx, keyword.keyword, y + 180, `900 100px ${SERIF}`, "#ffe9b8");
    ctx.restore();
    const note = KEYWORD_NOTES[keyword.keyword];
    if (note) center(ctx, `「${note}」`, y + 240, `500 26px ${SERIF}`, "rgba(255,233,184,0.8)");
    y += ph + 110;
  }
  if (highlight) {
    const best = metrics.daily.find((day) => day.date === highlight.date);
    const text = `高光镜头　${shortDate(highlight.date)} 周${weekdayOf(highlight.date)} · ${num(best?.reviews ?? 0)} 次作答`;
    ctx.font = `700 34px ${FONT_SANS}`;
    const tw = ctx.measureText(text).width; const bx = (W - tw) / 2 - 36; const bw = tw + 72; const by = y - 56; const bh = 86;
    ctx.strokeStyle = "#d8ecff"; ctx.lineWidth = 3;
    for (const [cx, cy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]] as const) {
      ctx.beginPath(); ctx.moveTo(cx + dx * 26, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * 26); ctx.stroke();
    }
    center(ctx, text, y, `700 34px ${FONT_SANS}`, "#eef3fa");
    y += 100;
  }

  // 片尾：场记水豚 + 累计 +「完」
  const bottom = H - 200;
  const crewW = drawImageAt(ctx, await loadImage(stickerUrl("scene-book")), 110, bottom, 140);
  ctx.font = `600 26px ${FONT_SANS}`; ctx.fillStyle = MUTED; ctx.fillText("场记", 110 + crewW + 16, bottom - 90);
  ctx.font = `900 40px ${SERIF}`; ctx.fillStyle = FG; ctx.fillText("水豚", 110 + crewW + 16, bottom - 40);
  ctx.textAlign = "right";
  ctx.font = `600 28px ${FONT_SANS}`; ctx.fillStyle = MUTED; ctx.fillText(`累计 ${num(metrics.cumulativeDays)} 个学习日`, W - 250, bottom - 96);
  ctx.font = `900 50px ${SERIF}`; ctx.fillStyle = FG; ctx.fillText(`${num(metrics.cumulativeWords)} 个词`, W - 250, bottom - 36);
  ctx.textAlign = "left";
  ctx.save(); ctx.translate(W - 150, bottom - 70); ctx.rotate(-0.21);
  ctx.strokeStyle = "#d8483e"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 64, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.font = `900 64px ${SERIF}`; ctx.fillStyle = "#d8483e"; ctx.textAlign = "center"; ctx.fillText("完", 0, 22);
  ctx.restore(); ctx.textAlign = "left";
  await brandRow(ctx, H - 110, FG, MUTED);
  return toPngBlob(canvas);
}
