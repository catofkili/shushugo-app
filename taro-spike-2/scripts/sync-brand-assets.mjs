import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
// 2026-10-14：scene-laptop / stretch / music 是主页大卡按时段换的那只（96px），原来是问候行的小图
const mainNames = {
  'scene-laptop': 96, 'scene-book': 56, 'mood-yay': 120, 'mood-puzzled': 52,
  'mood-dizzy': 120, 'mood-sleep': 112, 'mood-default': 96, 'mood-hungry': 110,
  'mood-fired-up': 96, 'mood-cheer': 68, 'scene-team': 96,
  'scene-stretch': 96, 'scene-music': 96, 'mood-wave': 84, 'mood-ask': 48,
  'mood-shy': 64, 'mood-surprised': 34, 'empty-box': 72,
  // 2026-10-14 v3：主页学习工具十格 + 组队格换成物件插画（tool-*），水豚 icon-* 只剩柚子商店皮肤预览在用（content-pages）
  'tool-modes': 44, 'tool-grammar': 44, 'tool-wordlist': 44, 'tool-confusion': 44,
  'tool-talk': 44, 'tool-jlpt': 44, 'tool-kanji-readings': 44, 'tool-favorites': 44,
  'tool-vocab-test': 44, 'tool-shop': 44, 'tool-team': 34,
  // 同一批图「藏着水豚」的版本（v3 §1.6 巧思 1：每次进主页随机 0–2 格换成它）
  'tool-modes-capy': 44, 'tool-grammar-capy': 44, 'tool-wordlist-capy': 44, 'tool-confusion-capy': 44,
  'tool-talk-capy': 44, 'tool-jlpt-capy': 44, 'tool-kanji-readings-capy': 44, 'tool-favorites-capy': 44,
  'tool-vocab-test-capy': 44, 'tool-shop-capy': 44, 'tool-team-capy': 34, 'empty-bye': 64,
  // 主页模式下拉图标和单词完成页 / 庆祝层的柚子币、皇冠。
  'mode-classic': 32, 'mode-mixed': 32, 'mode-mistakes': 32, 'mode-quick': 32,
  'mode-reverse': 32, 'mode-kanji': 32, 'mode-picked': 32, 'crown': 52, 'yuzu-coin': 20,
  'shushugo-icon': 56, 'shushugo-icon-dark': 56, 'walk-strip': 72
};
const mainOneX = new Set(['mood-ask', 'mood-surprised']);
const packageNames = {
  study: {
    'empty-box': 96, 'empty-search': 96, 'mood-ask': 96, 'mood-idea': 64, 'mood-proud': 96,
    // 备考页倒计时那只按状态拼名（来得及 / 来不及 / 考完），来不及那张 mood-shocked 只登记在 account 分包时，备考页是一张空图。
    'mood-shocked': 108,
    'emblem-sprout': 28, 'emblem-squirrel': 28, 'emblem-bird': 28, 'emblem-train': 28,
    'emblem-owl': 28, 'emblem-yuzu': 28, 'emblem-books': 28, 'emblem-torii': 28
  },
  account: {
    'mood-ask': 96, 'mood-heart': 92, 'mood-proud': 96, 'mood-shocked': 48
  },
  'content-pages': {
    'empty-box': 88, 'empty-search': 96, 'mood-proud': 64,
    // WeeklyReportStory's chapter lookup is dynamic; all three must be in this package.
    'mood-idea': 84, 'mood-love': 84, 'mood-fight': 84,
    // 连胜详情页：快断了的那只（StreakPageView）。
    'mood-shocked': 64,
    'crown': 44, 'yuzu-coin': 18,
    // 收藏页页头。
    'mood-heart': 60,
    'icon-study-modes': 36, 'icon-grammar': 36, 'icon-vocab': 36,
    'icon-practice': 36, 'icon-kanji-readings': 36, 'icon-favorites': 36,
    'icon-stats': 36, 'icon-shop': 36,
    'shushugo-icon': 96, 'shushugo-icon-dark': 96, 'shushugo-cover': 180,
    'mood-happy': 150, 'mood-study': 150, 'item-repair': 150,
    'item-voice-female-2': 150, 'item-voice-male': 150,
    'item-sound-marimba-2': 150, 'item-sound-epiano-2': 150,
    'roll-frame': 150, 'card-daily': 150, 'decor-set': 150
  }
};
const out = path.join(root, 'src/assets/brand');
const packageOut = path.join(root, 'src/package-assets');
const reportPath = path.join(root, 'reports/brand-asset-sizes.json');
const previousReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
const previousSizes = new Map((previousReport?.formatVersion === 2 ? previousReport.images : [])
  .map((image) => [`${image.subpackage ?? 'main'}/${image.image}`, image]));
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'shushugo-brand-assets-'));
const targets = [
  ...Object.entries(mainNames).map(([image, maxDisplayHeightCss]) => ({ image, maxDisplayHeightCss, subpackage: null, scale: mainOneX.has(image) ? 1 : 2 })),
  ...Object.entries(packageNames).flatMap(([subpackage, images]) => Object.entries(images)
    .map(([image, maxDisplayHeightCss]) => ({ image, maxDisplayHeightCss, subpackage, scale: 2 })))
];
const sourcePath = (image) => ['shushugo-icon', 'shushugo-icon-dark', 'shushugo-cover'].includes(image)
  ? path.join(repo, `frontend/public/brand/${image}.png`)
  : path.join(repo, `frontend/public/brand/sheet/${image}.png`);
const targetPath = ({ image, subpackage }) => path.join(
  subpackage ? path.join(packageOut, subpackage, 'brand') : out,
  `${image}.png`
);
const previousOutputPath = ({ image, subpackage }) => path.join(
  subpackage ? path.join(packageOut, subpackage, 'brand') : out,
  `${image}.webp`
);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
// 保留经过逐像素验证的无损重压产物，不让下一次 pngquant 覆盖掉收益。
// 输入原图、尺寸档位、质量配置或现有输出摘要有任何变化，照常重新生成；不引入构建机上的 Python / zopfli 依赖。
const previousOutputs = new Map(targets.filter((target) => existsSync(targetPath(target)))
  .map((target) => [`${target.subpackage ?? 'main'}/${target.image}`, readFileSync(targetPath(target))]));
const pngDimensions = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });
const measureExisting = (filename, legacyFilename, key) => {
  const recorded = previousSizes.get(key);
  if (recorded) return { bytes: recorded.beforeBytes, format: recorded.beforeFormat };
  if (existsSync(legacyFilename)) return { bytes: statSync(legacyFilename).size, format: 'webp' };
  if (existsSync(filename)) return { bytes: statSync(filename).size, format: 'png' };
  return { bytes: 0, format: 'none' };
};

try {
  const before = new Map(targets.map((target) => {
    const filename = targetPath(target);
    const prior = measureExisting(filename, previousOutputPath(target), `${target.subpackage ?? 'main'}/${target.image}`);
    return [`${target.subpackage ?? 'main'}/${target.image}`, prior];
  }));
  rmSync(out, { recursive: true, force: true });
  for (const subpackage of Object.keys(packageNames)) rmSync(path.join(packageOut, subpackage, 'brand'), { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const measurements = [];
  for (const target of targets) {
    const source = sourcePath(target.image);
    const original = readFileSync(source);
    const { width: sourceWidth, height: sourceHeight } = pngDimensions(original);
    const outputHeight = target.maxDisplayHeightCss * target.scale;
    const outputWidth = Math.round(sourceWidth * outputHeight / sourceHeight);
    const destination = targetPath(target);
    mkdirSync(path.dirname(destination), { recursive: true });
    const key = `${target.subpackage ?? 'main'}/${target.image}`;
    const priorImage = previousSizes.get(key);
    const priorOutput = previousOutputs.get(key);
    const sourceSha256 = sha256(original);
    const quality = target.subpackage ? '65-90' : '60-85';
    const keepLossless = !target.subpackage && priorImage?.losslessOptimized && priorOutput
      && priorImage.sourceSha256 === sourceSha256 && priorImage.afterSha256 === sha256(priorOutput)
      && priorImage.outputWidth === outputWidth && priorImage.outputHeight === outputHeight
      && priorImage.scale === target.scale && priorImage.maxDisplayHeightCss === target.maxDisplayHeightCss
      && priorImage.quality === quality;
    const resized = path.join(tempDir, `${target.subpackage ?? 'main'}-${target.image}.png`);
    if (keepLossless) writeFileSync(destination, priorOutput);
    else {
      execFileSync('sips', ['--resampleHeightWidth', String(outputHeight), String(outputWidth), source, '--out', resized], { stdio: 'ignore' });
      // pngquant applies a 256-color RGBA palette; it keeps the output as PNG, which iOS Mini Program <image> can load locally.
      // 主包贴纸压到 60-85：主包离 1.9 MB 闸门只剩几 KB（2026-09-27 合 W24+W26 时超了 3 KB），小尺寸贴纸看不出差别。
      execFileSync('pngquant', ['256', '--quality', quality, '--speed', '1', '--force', '--output', destination, resized], { stdio: 'ignore' });
    }
    const prior = before.get(`${target.subpackage ?? 'main'}/${target.image}`);
    measurements.push({
      subpackage: target.subpackage ?? 'main',
      image: target.image,
      sourceWidth,
      sourceHeight,
      maxDisplayHeightCss: target.maxDisplayHeightCss,
      scale: target.scale,
      outputWidth,
      outputHeight,
      beforeFormat: prior.format,
      beforeBytes: prior.bytes,
      afterFormat: 'png',
      afterBytes: statSync(destination).size,
      sourceSha256,
      afterSha256: sha256(readFileSync(destination)),
      quality,
      ...(keepLossless ? { losslessOptimized: true } : {})
    });
  }

  const packageBytes = (subpackage, field) => measurements
    .filter((image) => image.subpackage === subpackage)
    .reduce((sum, image) => sum + image[field], 0);
  const packages = Object.fromEntries(['main', ...Object.keys(packageNames)].map((subpackage) => [subpackage, {
    beforeBytes: packageBytes(subpackage, 'beforeBytes'),
    afterBytes: packageBytes(subpackage, 'afterBytes')
  }]));
  const brandPackages = {};
  for (const [subpackage, images] of Object.entries(packageNames)) {
    for (const image of Object.keys(images)) (brandPackages[image] ??= []).push(subpackage);
  }
  // Reuse the repeated package name so adding weekly assets does not grow the main package.
  writeFileSync(path.join(root, 'src/platform/brand-packages.cjs'), `const contentPackage = 'content-pages';\nmodule.exports = ${JSON.stringify(brandPackages, null, 2).replaceAll('"content-pages"', 'contentPackage')};\n`);
  writeFileSync(reportPath, `${JSON.stringify({
    formatVersion: 2,
    compression: 'pngquant 256-color palette: main quality 60-85, subpackage quality 65-90; verified lossless main outputs retained by source/output SHA256',
    packages,
    images: measurements
  }, null, 2)}\n`);

  const main = packages.main;
  console.log(`已同步 ${Object.keys(mainNames).length} 张主包 PNG 和 ${targets.length - Object.keys(mainNames).length} 张分包 PNG；主包贴纸 ${main.beforeBytes} -> ${main.afterBytes} B`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
