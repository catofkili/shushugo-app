import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, '../wechat-miniprogram/src');
const files = [
  'content/question-meanings.js',
  'content/kanji-unit-runtime.js',
  'content/kanji-reading-usage.js',
  'content/pitch-accent.js',
  'features/content/distinction-reviews.js',
  'features/content/kanji-variants.js',
  'features/content/kanji-readings.js',
  'features/content/grammar-key-points.js'
];

for (const relative of files) {
  const source = path.join(sourceRoot, relative);
  const target = path.join(root, 'dist', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
console.log(`构建后原样恢复 ${files.length} 份出厂内容文件`);
