// 裁一格 → Catmull-Rom 双三次放大 → 在放大后的图上抠面板底色（软边 + 边缘颜色外推），不留锯齿和灰边。
import { decode, encode } from "./png.mjs";
const [,, src, out, x0, y0, w0, h0, scaleArg = "3", bgLimit = "212"] = process.argv;
// SAT:面板底色允许的最大饱和度(默认 20)。鳄鱼分图有几格是奶油/淡粉底(sat≈24),要放宽
const S = +scaleArg, BG = +bgLimit, SAT = +(process.env.SAT || 20);
const img = decode(src);
const X = +x0, Y = +y0, W = +w0, H = +h0;

// ---- 1. 裁 ----
const crop = new Float32Array(W * H * 4);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) for (let c = 0; c < 4; c++) crop[(j * W + i) * 4 + c] = img.px[((Y + j) * img.w + X + i) * 4 + c];

// ---- 2. 双三次放大（分离卷积，Catmull-Rom a=-0.5）----
const k = (t) => { t = Math.abs(t); return t < 1 ? 1.5 * t ** 3 - 2.5 * t * t + 1 : t < 2 ? -0.5 * t ** 3 + 2.5 * t * t - 4 * t + 2 : 0; };
const resample = (data, sw, sh, dw, dh) => {
  const tmp = new Float32Array(dw * sh * 4), outp = new Float32Array(dw * dh * 4);
  for (let x = 0; x < dw; x++) { const sx = (x + .5) * sw / dw - .5, ix = Math.floor(sx); const ws = [-1, 0, 1, 2].map(d => k(sx - (ix + d)));
    for (let y = 0; y < sh; y++) for (let c = 0; c < 4; c++) { let v = 0, wsum = 0; for (let d = -1; d <= 2; d++) { const px = Math.min(sw - 1, Math.max(0, ix + d)); const wgt = ws[d + 1]; v += wgt * data[(y * sw + px) * 4 + c]; wsum += wgt; } tmp[(y * dw + x) * 4 + c] = v / wsum; } }
  for (let y = 0; y < dh; y++) { const sy = (y + .5) * sh / dh - .5, iy = Math.floor(sy); const ws = [-1, 0, 1, 2].map(d => k(sy - (iy + d)));
    for (let x = 0; x < dw; x++) for (let c = 0; c < 4; c++) { let v = 0, wsum = 0; for (let d = -1; d <= 2; d++) { const py = Math.min(sh - 1, Math.max(0, iy + d)); const wgt = ws[d + 1]; v += wgt * tmp[(py * dw + x) * 4 + c]; wsum += wgt; } outp[(y * dw + x) * 4 + c] = v / wsum; } }
  return outp;
};
const DW = W * S, DH = H * S, up = resample(crop, W, H, DW, DH);

// ---- 3. 硬掩膜：从四边泛洪，走「亮、低饱和」的面板底色 ----
const near = (i) => { const r = up[i*4], g = up[i*4+1], b = up[i*4+2], a = up[i*4+3]; return a < 236 || (Math.min(r, g, b) > BG && Math.max(r, g, b) - Math.min(r, g, b) < SAT); };
const M = new Uint8Array(DW * DH), st = [];
for (let i = 0; i < DW; i++) st.push(i, (DH - 1) * DW + i); for (let j = 0; j < DH; j++) st.push(j * DW, j * DW + DW - 1);
while (st.length) { const i = st.pop(); if (M[i] || !near(i)) continue; M[i] = 1; const c = i % DW; if (c) st.push(i - 1); if (c < DW - 1) st.push(i + 1); if (i >= DW) st.push(i - DW); if (i + DW < DW * DH) st.push(i + DW); }

// 3b. 掩膜向内膨胀 1px：原图抗锯齿时最外一圈是「描边 × 底色」的混色，比描边浅一档，留着就是一圈灰白边
if (!process.env.THIN) { const n = new Uint8Array(M); for (let i = 0; i < DW * DH; i++) if (M[i]) { const c = i % DW; if (c) n[i-1]=1; if (c<DW-1) n[i+1]=1; if (i>=DW) n[i-DW]=1; if (i+DW<DW*DH) n[i+DW]=1; } M.set(n); }

// ---- 4. 软 alpha：掩膜做两遍 5×5 盒式模糊 ≈ 高斯，边缘过渡约 2px（放大后）----
const blur = (m) => { const o = new Float32Array(m.length); for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) { let s = 0, n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= DH || xx < 0 || xx >= DW) { s += 1; n++; continue; } s += m[yy * DW + xx]; n++; } o[y * DW + x] = s / n; } return o; };
// THIN=1：细笔画（标语小字）不蚀边、只模糊一遍，否则 4px 宽的笔画会被吃成半透明
const soft = process.env.THIN ? blur(Float32Array.from(M)) : blur(blur(Float32Array.from(M)));

// ---- 5. 边缘颜色外推：透明区里带一点 alpha 的像素，颜色从相邻的前景像素取，避免灰边 ----
const col = new Float32Array(DW * DH * 3), has = new Uint8Array(DW * DH);
for (let i = 0; i < DW * DH; i++) if (!M[i]) { col[i*3] = up[i*4]; col[i*3+1] = up[i*4+1]; col[i*3+2] = up[i*4+2]; has[i] = 1; }
for (let pass = 0; pass < S * 3; pass++) { const nh = new Uint8Array(has); for (let i = 0; i < DW * DH; i++) { if (has[i]) continue; const c = i % DW; let r = 0, g = 0, b = 0, n = 0; for (const j of [c ? i - 1 : -1, c < DW - 1 ? i + 1 : -1, i >= DW ? i - DW : -1, i + DW < DW * DH ? i + DW : -1]) if (j >= 0 && has[j]) { r += col[j*3]; g += col[j*3+1]; b += col[j*3+2]; n++; } if (n) { col[i*3] = r / n; col[i*3+1] = g / n; col[i*3+2] = b / n; nh[i] = 1; } } has.set(nh); }

// ---- 6. 合成 ----
const px = Buffer.alloc(DW * DH * 4);
for (let i = 0; i < DW * DH; i++) { const a = Math.round(Math.max(0, Math.min(1, 1 - soft[i])) * 255); const src4 = M[i] ? [col[i*3], col[i*3+1], col[i*3+2]] : [up[i*4], up[i*4+1], up[i*4+2]]; px[i*4] = Math.max(0, Math.min(255, Math.round(src4[0]))); px[i*4+1] = Math.max(0, Math.min(255, Math.round(src4[1]))); px[i*4+2] = Math.max(0, Math.min(255, Math.round(src4[2]))); px[i*4+3] = a; }
// ERASE=x0,y0,x1,y1（裁剪框内坐标，放大前）：把这一块抠掉——总表上相邻两格挨太近、x 上分不开时用
if (process.env.ERASE) { const [ex0, ey0, ex1, ey1] = process.env.ERASE.split(",").map(v => +v * S); for (let y = ey0; y < Math.min(DH, ey1); y++) for (let x = ex0; x < Math.min(DW, ex1); x++) px[(y * DW + x) * 4 + 3] = 0; }

// ---- 7. TRIM=1：裁到不透明像素的包围盒（留 PAD px 边）----
if (process.env.TRIM) {
  const PAD = +(process.env.PAD ?? 6); let x1 = DW, y1 = DH, x2 = -1, y2 = -1;
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) if (px[(y * DW + x) * 4 + 3] > 8) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  x1 = Math.max(0, x1 - PAD); y1 = Math.max(0, y1 - PAD); x2 = Math.min(DW - 1, x2 + PAD); y2 = Math.min(DH - 1, y2 + PAD);
  const TW = x2 - x1 + 1, TH = y2 - y1 + 1, t = Buffer.alloc(TW * TH * 4);
  for (let y = 0; y < TH; y++) t.set(px.subarray(((y1 + y) * DW + x1) * 4, ((y1 + y) * DW + x1 + TW) * 4), y * TW * 4);
  encode(out, { w: TW, h: TH, px: t });
} else encode(out, { w: DW, h: DH, px });
