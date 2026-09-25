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

for (const name of names) {
  execFileSync('cwebp', [
    '-quiet', '-q', '82',
    path.join(repo, `frontend/public/brand/sheet/${name}.png`),
    '-o', path.join(out, `${name}.webp`)
  ]);
}
execFileSync('cwebp', [
  '-quiet', '-q', '82',
  path.join(repo, 'frontend/public/brand/shushugo-icon.png'),
  '-o', path.join(out, 'shushugo-icon.webp')
]);
execFileSync('cwebp', [
  '-quiet', '-q', '82',
  path.join(repo, 'frontend/public/brand/sheet/walk-strip.png'),
  '-o', path.join(out, 'walk-strip.webp')
]);

console.log(`已压缩并同步 ${names.length + 2} 张品牌图片到主包 assets`);
