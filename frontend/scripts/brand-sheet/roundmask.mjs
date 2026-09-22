// 裁一块 + 圆角矩形 alpha 蒙版（抗锯齿）：给 App 图标那种「自带底色的方块」用，泛洪抠底会把底色一起抠掉。
import { decode, encode } from "./png.mjs";
const [,, src, out, x0, y0, w, h, rArg] = process.argv;
const img = decode(src), W = +w, H = +h, R = +rArg;
const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const s = ((+y0 + y) * img.w + +x0 + x) * 4, d = (y * W + x) * 4;
  px.set(img.px.subarray(s, s + 3), d);
  // 到圆角矩形的有符号距离，±0.5px 内线性过渡
  const cx = Math.max(R - x - .5, 0, x + .5 - (W - R)), cy = Math.max(R - y - .5, 0, y + .5 - (H - R));
  const dist = Math.hypot(cx, cy) - R;
  px[d + 3] = Math.round(255 * Math.max(0, Math.min(1, .5 - dist)));
}
encode(out, { w: W, h: H, px });
