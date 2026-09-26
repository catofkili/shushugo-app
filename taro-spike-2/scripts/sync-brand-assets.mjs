import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const mainNames = {
  'scene-laptop': 92, 'scene-book': 96, 'mood-yay': 120, 'mood-puzzled': 96,
  'mood-dizzy': 120, 'mood-sleep': 112, 'mood-default': 96, 'mood-hungry': 110,
  'mood-fired-up': 96, 'mood-cheer': 96, 'scene-team': 96,
  'scene-stretch': 78, 'scene-music': 78, 'mood-wave': 84,
  'icon-study-modes': 36, 'icon-grammar': 36, 'icon-vocab': 36,
  'icon-practice': 36, 'icon-kanji-readings': 36, 'icon-favorites': 36,
  'icon-stats': 36, 'icon-shop': 36
};
const packageNames = {
  study: ['empty-box', 'mood-ask', 'mood-proud'],
  account: ['mood-proud'],
  'content-pages': ['icon-study-modes', 'icon-grammar', 'icon-vocab', 'icon-practice', 'icon-kanji-readings', 'icon-favorites', 'icon-stats', 'icon-shop', 'shushugo-icon']
};
const out = path.join(root, 'src/assets/brand');
const packageOut = path.join(root, 'src/package-assets');
const reportPath = path.join(root, 'reports/brand-asset-sizes.json');
const mainImages = [...Object.entries(mainNames), ['shushugo-icon', 56], ['walk-strip', 72]];
const previousReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
const recordedBeforeBytes = new Map((previousReport?.images ?? []).map((image) => [image.image, image.beforeBytes]));
const beforeBytes = new Map(mainImages.map(([name]) => {
  const filename = path.join(out, `${name}.webp`);
  const prior = recordedBeforeBytes.get(name);
  return [name, Number.isFinite(prior) ? prior : (existsSync(filename) ? statSync(filename).size : null)];
}));
const measurements = [];
rmSync(out, { recursive: true, force: true });
for (const subpackage of Object.keys(packageNames)) rmSync(path.join(packageOut, subpackage, 'brand'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 原图统一留在 frontend/public。根包图片按各页面最大 CSS 高度的 2 倍像素导出。
function compressMain(name, displayHeightCss, source) {
  const png = readFileSync(source);
  const sourceWidth = png.readUInt32BE(16);
  const sourceHeight = png.readUInt32BE(20);
  const output = path.join(out, `${name}.webp`);
  const outputHeight = displayHeightCss * 2;
  execFileSync('cwebp', [
    '-quiet', '-q', '78', '-resize', '0', String(outputHeight), source,
    '-o', output
  ]);
  measurements.push({
    image: name,
    maxDisplayHeightCss: displayHeightCss,
    sourceWidth,
    sourceHeight,
    outputHeight,
    beforeBytes: beforeBytes.get(name),
    afterBytes: statSync(output).size
  });
}

for (const [name, displayHeightCss] of Object.entries(mainNames)) {
  compressMain(name, displayHeightCss, path.join(repo, `frontend/public/brand/sheet/${name}.png`));
}

for (const [subpackage, names] of Object.entries(packageNames)) {
  const destination = path.join(packageOut, subpackage, 'brand');
  mkdirSync(destination, { recursive: true });
  for (const name of names) {
    const source = name === 'shushugo-icon'
      ? path.join(repo, 'frontend/public/brand/shushugo-icon.png')
      : path.join(repo, `frontend/public/brand/sheet/${name}.png`);
    execFileSync('cwebp', [
      '-quiet', '-q', '82', '-resize', name === 'shushugo-icon' ? '288' : '390', '0',
      source,
      '-o', path.join(destination, `${name}.webp`)
    ]);
  }
}

compressMain('shushugo-icon', 56, path.join(repo, 'frontend/public/brand/shushugo-icon.png'));
compressMain('walk-strip', 72, path.join(repo, 'frontend/public/brand/sheet/walk-strip.png'));

const mainBytesBefore = measurements.reduce((sum, image) => sum + (image.beforeBytes ?? 0), 0);
const mainBytesAfter = measurements.reduce((sum, image) => sum + image.afterBytes, 0);
writeFileSync(reportPath, `${JSON.stringify({
  quality: 78,
  scale: 2,
  mainBytesBefore,
  mainBytesAfter,
  savedBytes: mainBytesBefore - mainBytesAfter,
  images: measurements
}, null, 2)}\n`);

console.log(`已同步 ${Object.keys(mainNames).length + 2} 张主包品牌图和 ${Object.values(packageNames).flat().length} 张子包品牌图；主包 ${mainBytesBefore} -> ${mainBytesAfter} B（省 ${mainBytesBefore - mainBytesAfter} B）`);
