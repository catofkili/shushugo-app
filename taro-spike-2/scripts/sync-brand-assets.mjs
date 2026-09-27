import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const mainNames = {
  'scene-laptop': 92, 'scene-book': 56, 'mood-yay': 120, 'mood-puzzled': 52,
  'mood-dizzy': 120, 'mood-sleep': 112, 'mood-default': 96, 'mood-hungry': 110,
  'mood-fired-up': 96, 'mood-cheer': 68, 'scene-team': 96,
  'scene-stretch': 78, 'scene-music': 78, 'mood-wave': 84, 'mood-ask': 48,
  'mood-shy': 64, 'mood-surprised': 34, 'empty-box': 72,
  'icon-study-modes': 36, 'icon-grammar': 36, 'icon-vocab': 36,
  'icon-practice': 36, 'icon-kanji-readings': 36, 'icon-favorites': 36,
  'icon-stats': 36, 'icon-shop': 36, 'empty-bye': 64,
  'shushugo-icon': 56, 'shushugo-icon-dark': 56, 'walk-strip': 72
};
const mainOneX = new Set(['mood-ask', 'mood-surprised']);
const packageNames = {
  study: {
    'empty-box': 96, 'empty-search': 96, 'mood-ask': 96, 'mood-idea': 64, 'mood-proud': 96
  },
  account: {
    'mood-ask': 96, 'mood-heart': 92, 'mood-proud': 96, 'mood-shocked': 48
  },
  'content-pages': {
    'empty-box': 88, 'empty-search': 96, 'mood-proud': 64,
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
    const resized = path.join(tempDir, `${target.subpackage ?? 'main'}-${target.image}.png`);
    execFileSync('sips', ['--resampleHeightWidth', String(outputHeight), String(outputWidth), source, '--out', resized], { stdio: 'ignore' });
    // pngquant applies a 256-color RGBA palette; it keeps the output as PNG, which iOS Mini Program <image> can load locally.
    execFileSync('pngquant', ['256', '--quality', '65-90', '--speed', '1', '--force', '--output', destination, resized], { stdio: 'ignore' });
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
      afterBytes: statSync(destination).size
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
  writeFileSync(path.join(root, 'src/platform/brand-packages.cjs'), `module.exports = ${JSON.stringify(brandPackages, null, 2)};\n`);
  writeFileSync(reportPath, `${JSON.stringify({
    formatVersion: 2,
    compression: 'pngquant 256-color palette, quality 65-90',
    packages,
    images: measurements
  }, null, 2)}\n`);

  const main = packages.main;
  console.log(`已同步 ${Object.keys(mainNames).length} 张主包 PNG 和 ${targets.length - Object.keys(mainNames).length} 张分包 PNG；主包贴纸 ${main.beforeBytes} -> ${main.afterBytes} B`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
