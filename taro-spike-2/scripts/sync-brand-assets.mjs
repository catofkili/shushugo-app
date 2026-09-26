import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const mainNames = {
  'scene-laptop': 390, 'scene-book': 390, 'mood-yay': 390, 'mood-puzzled': 390,
  'mood-dizzy': 390, 'mood-sleep': 390, 'mood-default': 390, 'mood-hungry': 390,
  'mood-fired-up': 390, 'mood-cheer': 390, 'scene-team': 390,
  'scene-stretch': 234, 'scene-music': 234, 'mood-wave': 138,
  'icon-study-modes': 108, 'icon-grammar': 108, 'icon-vocab': 108,
  'icon-practice': 108, 'icon-kanji-readings': 108, 'icon-favorites': 108,
  'icon-stats': 108, 'icon-shop': 108
};
const packageNames = {
  study: ['empty-box', 'mood-ask', 'mood-proud'],
  account: ['mood-proud'],
  'content-pages': ['icon-study-modes', 'icon-grammar', 'icon-vocab', 'icon-practice', 'icon-kanji-readings', 'icon-favorites', 'icon-stats', 'icon-shop', 'shushugo-icon']
};
const out = path.join(root, 'src/assets/brand');
const packageOut = path.join(root, 'src/package-assets');
rmSync(out, { recursive: true, force: true });
for (const subpackage of Object.keys(packageNames)) rmSync(path.join(packageOut, subpackage, 'brand'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 原图统一留在 frontend/public。根包页面按实际显示尺寸取 3 倍像素；贴纸仍用作者原图。
for (const [name, width] of Object.entries(mainNames)) {
  execFileSync('cwebp', [
    '-quiet', '-q', '82', '-resize', String(width), '0',
    path.join(repo, `frontend/public/brand/sheet/${name}.png`),
    '-o', path.join(out, `${name}.webp`)
  ]);
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

execFileSync('cwebp', [
  // 根包图标最大显示约 56px；关于页使用子包中的 288px 版本。
  '-quiet', '-q', '82', '-resize', '168', '0',
  path.join(repo, 'frontend/public/brand/shushugo-icon.png'),
  '-o', path.join(out, 'shushugo-icon.webp')
]);
execFileSync('cwebp', [
  // 走路条最大显示 72px 高，四帧合计按 3 倍屏缩放。
  '-quiet', '-q', '82', '-resize', '788', '0',
  path.join(repo, 'frontend/public/brand/sheet/walk-strip.png'),
  '-o', path.join(out, 'walk-strip.webp')
]);

console.log(`已同步 ${Object.keys(mainNames).length + 2} 张主包品牌图和 ${Object.values(packageNames).flat().length} 张子包品牌图`);
