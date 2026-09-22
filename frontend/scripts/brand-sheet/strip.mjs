// 四帧走路图拼成一条横向 sprite（等宽格子，底对齐居中）
import { decode, encode } from "./png.mjs";
const dir = "/Users/lsc/Documents/shushugo/frontend/public/brand/sheet/";
const frames = [1,2,3,4].map(i => decode(`${dir}walk-${i}.png`));
const CW = Math.max(...frames.map(f => f.w)), CH = Math.max(...frames.map(f => f.h));
const px = Buffer.alloc(CW * 4 * CH * 4);
frames.forEach((f, k) => { const ox = k * CW + ((CW - f.w) >> 1), oy = CH - f.h; for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) px.set(f.px.subarray((y * f.w + x) * 4, (y * f.w + x) * 4 + 4), ((oy + y) * CW * 4 + ox + x) * 4); });
encode(`${dir}walk-strip.png`, { w: CW * 4, h: CH, px });
console.log("cell", CW, CH);
