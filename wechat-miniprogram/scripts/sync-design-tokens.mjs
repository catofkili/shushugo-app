import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = path.join(root, 'frontend/src/design.css');
const outputPath = path.join(root, 'wechat-miniprogram/src/styles/tokens.wxss');
const source = readFileSync(sourcePath, 'utf8');
const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...clean.matchAll(/(:root\s*,\s*\[data-theme="light"\]|\[data-theme="dark"\])\s*\{([^{}]*)\}/g)];

if (blocks.length !== 2) throw new Error(`预期从 design.css 读取浅色和深色变量段，实际找到 ${blocks.length} 段`);

function declarations(block) {
  return new Map([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const wxssFallbacks = new Map([
  ['--ds-primary', 'var(--zoo-primary, #69a840)'],
  ['--ds-primary-ink', 'var(--zoo-primary-deep, #5C8F32)'],
  ['--ds-on-primary', 'var(--zoo-on-primary, #ffffff)'],
]);

function supported(values) {
  const result = new Map();
  for (const [key, value] of values) {
    if (!/^(--ds-|--zoo-|--color-|--form-control-|--jelly-|--glass-)/.test(key)) continue;
    let normalized = wxssFallbacks.get(key) ?? value;
    if (/^--ds-(?:radius|font-size)-/.test(key)) {
      normalized = normalized.replace(/(-?(?:\d+\.?\d*|\.\d+))px\b/g, (_, pixels) => `${Number(pixels) * 2}rpx`);
    }
    if (/color-mix\(|\b(?:oklch|lab|lch|color)\(|\b(?:min|max|clamp)\(/i.test(normalized)) continue;
    result.set(key, normalized);
  }

  // Keep aliases only when their referenced values exist in the generated layer.
  for (let changed = true; changed;) {
    changed = false;
    for (const [key, value] of result) {
      const missing = [...value.matchAll(/var\((--[\w-]+)/g)].some(([ , dependency]) => !result.has(dependency));
      if (missing && !wxssFallbacks.has(key)) {
        result.delete(key);
        changed = true;
      }
    }
  }
  return result;
}

const light = supported(declarations(blocks[0][2]));
const dark = supported(declarations(blocks[1][2]));
const digest = createHash('sha256').update(source).digest('hex');
const format = (values) => [...values].map(([key, value]) => `  ${key}: ${value};`).join('\n');
const output = `/* Generated from frontend/src/design.css. Run node wechat-miniprogram/scripts/sync-design-tokens.mjs. */\n/* source sha256: ${digest} */\n/* WXSS does not support color-mix(); those values stay on the existing native fallback. */\npage {\n${format(light)}\n}\n\n.theme-dark {\n${format(dark)}\n}\n`;

if (process.argv.includes('--check')) {
  let actual = '';
  try { actual = readFileSync(outputPath, 'utf8'); } catch {}
  if (actual !== output) {
    console.error('设计变量已过期：运行 node wechat-miniprogram/scripts/sync-design-tokens.mjs');
    process.exitCode = 1;
  } else {
    console.log(`设计变量已同步（${light.size} 个浅色、${dark.size} 个深色）`);
  }
} else {
  writeFileSync(outputPath, output);
  console.log(`已生成 ${path.relative(root, outputPath)}（${light.size} 个浅色、${dark.size} 个深色）`);
}
