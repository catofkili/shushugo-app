// 几帧图拼成一条横向 sprite（等宽格子，底对齐居中）。用法：node strip.mjs [前缀=walk] [帧数=4]
// 输入 <前缀>-1.png … <前缀>-N.png，输出 <前缀>-strip.png。目录跟着脚本所在的 checkout 走（原来写死主目录）。
import { decode, encode } from "./png.mjs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("../../public/brand/sheet/", import.meta.url));
const [, , prefix = "walk", countArg = "4"] = process.argv;
const count = Number(countArg);
const frames = Array.from({ length: count }, (_, k) => decode(`${dir}${prefix}-${k + 1}.png`));
const CW = Math.max(...frames.map(f => f.w)), CH = Math.max(...frames.map(f => f.h));
const px = Buffer.alloc(CW * count * CH * 4);
frames.forEach((f, k) => { const ox = k * CW + ((CW - f.w) >> 1), oy = CH - f.h; for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) px.set(f.px.subarray((y * f.w + x) * 4, (y * f.w + x) * 4 + 4), ((oy + y) * CW * count + ox + x) * 4); });
encode(`${dir}${prefix}-strip.png`, { w: CW * count, h: CH, px });
console.log("cell", CW, CH);
