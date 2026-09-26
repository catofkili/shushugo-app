import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const names = [
  'scene-laptop', 'scene-book', 'empty-box', 'mood-yay', 'mood-puzzled',
  'mood-ask', 'mood-dizzy', 'mood-proud', 'mood-sleep'
];
const out = path.join(root, 'src/assets/brand');
mkdirSync(out, { recursive: true });

// 贴纸在页面上最大约 130px 宽（Sticker size 上限），按 3 倍屏取 390px；原图 440–520px 宽，全尺寸进主包白占字节。
for (const name of names) {
  execFileSync('cwebp', [
    '-quiet', '-q', '82', '-resize', '390', '0',
    path.join(repo, `frontend/public/brand/sheet/${name}.png`),
    '-o', path.join(out, `${name}.webp`)
  ]);
}
execFileSync('cwebp', [
  // 图标最大显示约 64px。
  '-quiet', '-q', '82', '-resize', '192', '0',
  path.join(repo, 'frontend/public/brand/shushugo-icon.png'),
  '-o', path.join(out, 'shushugo-icon.webp')
]);
execFileSync('cwebp', [
  '-quiet', '-q', '82',
  path.join(repo, 'frontend/public/brand/sheet/walk-strip.png'),
  '-o', path.join(out, 'walk-strip.webp')
]);

console.log(`已压缩并同步 ${names.length + 2} 张品牌图片到主包 assets`);
