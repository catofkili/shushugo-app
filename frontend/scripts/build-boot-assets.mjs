// 沿用 taro-spike-2/scripts/sync-brand-assets.mjs 的 sips + pngquant 流程；只派生 HTML 启动壳的两张图。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const brand = fileURLToPath(new URL("../public/brand/", import.meta.url));
const temporary = mkdtempSync(path.join(os.tmpdir(), "shushugo-boot-assets-"));
mkdirSync(path.join(brand, "boot"), { recursive: true });
try {
  for (const [name, displayHeight] of [["splash-sleep", 120], ["logo-lockup", 80]]) {
    const source = path.join(brand, "sheet", `${name}.png`);
    const original = readFileSync(source);
    // splash 原高只有 233px，不为凑 240px 放大原图。
    const height = Math.min(displayHeight * 2, original.readUInt32BE(20));
    const width = Math.round(original.readUInt32BE(16) * height / original.readUInt32BE(20));
    const resized = path.join(temporary, `${name}.png`);
    const output = path.join(brand, "boot", `${name}.png`);
    execFileSync("sips", ["--resampleHeightWidth", String(height), String(width), source, "--out", resized], { stdio: "ignore" });
    // 保留透明边缘，用调色板 PNG；不把 WKWebView / 微信本地图换成 WebP。
    execFileSync("pngquant", ["256", "--quality", "65-90", "--speed", "1", "--force", "--output", output, resized], { stdio: "ignore" });
    const generated = readFileSync(output);
    if (generated.readUInt32BE(16) !== width || generated.readUInt32BE(20) !== height) throw new Error(`${name}: 派生尺寸错误`);
    console.log(`${name}: ${original.length} -> ${generated.length} B (${width}×${height})`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
