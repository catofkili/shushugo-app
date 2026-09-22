// stdlib-only PNG read/write (8-bit RGB/RGBA, non-interlaced) + corner flood fill.
import { readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";

const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

export function decode(file) {
  const buf = readFileSync(file);
  let p = 8, w, h, ct, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error("unsupported"); }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : (() => { throw new Error("ct " + ct); })();
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0, x = line[i];
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) { const s = x * bpp, d = (y * w + x) * 4; out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = bpp === 4 ? cur[s + 3] : 255; }
    [prev, cur] = [cur, prev];
  }
  return { w, h, px: out };
}

export function encode(file, { w, h, px }, rgb = false) {
  const bpp = rgb ? 3 : 4, raw = Buffer.alloc(h * (w * bpp + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = y * (w * bpp + 1) + 1 + x * bpp; raw[d] = px[s]; raw[d + 1] = px[s + 1]; raw[d + 2] = px[s + 2]; if (!rgb) raw[d + 3] = px[s + 3]; }
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = rgb ? 2 : 6;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

/** Flood from the 4 corners through "dark-ish" pixels (lum < limit); returns Uint8Array mask (1 = outside). */
export function cornerMask({ w, h, px }, limit = 235) {
  const mask = new Uint8Array(w * h), stack = [0, w - 1, (h - 1) * w, h * w - 1];
  const lum = (i) => (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  while (stack.length) {
    const i = stack.pop();
    if (mask[i] || lum(i) >= limit) continue;
    mask[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1); if (i >= w) stack.push(i - w); if (i + w < w * h) stack.push(i + w);
  }
  return mask;
}
