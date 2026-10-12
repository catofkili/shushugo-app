// 小程序不能列云目录；从网页原图生成两端共用的文件名清单。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const images = new URL('../src/assets/talk-scenes/', import.meta.url);
const output = new URL('../src/data/talk_scene_images.json', import.meta.url);
const manifest = {};
for (const file of readdirSync(images).filter((name) => name.endsWith('.jpg')).sort()) {
  const match = /^(S\d{2})(?:-([2-9]|[1-9]\d+))?\.jpg$/u.exec(file);
  assert(match, `场景图文件名不符合约定：${file}`);
  (manifest[match[1]] ??= []).push(file);
}
for (const [scene, files] of Object.entries(manifest)) {
  assert(files.includes(`${scene}.jpg`), `${scene} 缺少首图，不能用于加载失败回退`);
  const number = (file) => Number(/-(\d+)\.jpg$/u.exec(file)?.[1] ?? 1);
  files.sort((a, b) => number(a) - number(b));
}
const json = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes('--check')) {
  assert.equal(readFileSync(output, 'utf8'), json, '场景图清单已过期：运行 node scripts/build-talk-scene-images.mjs');
} else {
  writeFileSync(output, json);
}
console.log(`场景图清单：${Object.keys(manifest).length} 个场景 / ${Object.values(manifest).flat().length} 张`);
