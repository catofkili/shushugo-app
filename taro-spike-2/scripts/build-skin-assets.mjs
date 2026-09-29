import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const sourceRoot = path.join(repo, 'frontend/src');
const outputRoot = path.join(root, 'skin-dist');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const sharedPath = path.join(sourceRoot, 'lib/mascot-skins.ts');
const sharedSource = readFileSync(sharedPath, 'utf8');
const compiled = ts.transpileModule(sharedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const sharedModule = { exports: {} };
new Function('exports', 'require', 'module', compiled)(sharedModule.exports, require, sharedModule);
const skins = sharedModule.exports.MASCOT_SKINS;

const sourceFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const filename = path.join(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(filename) : /\.(tsx?|jsx?)$/.test(entry.name) ? [filename] : [];
});
const exactHeights = new Map();
let dynamicHeight = 0;
let hasUnknownDynamicHeight = false;
for (const filename of sourceFiles(sourceRoot)) {
  const source = readFileSync(filename, 'utf8');
  const componentSource = filename.endsWith('/components/CapybaraMascot.tsx');
  const use = /<(Sticker|CapybaraMascot)\b([^>]*?)\/?\s*>/gs;
  for (const match of source.matchAll(use)) {
    const [tag, attributes] = [match[1], match[2]];
    if (componentSource && tag === 'Sticker') continue;
    const literalName = tag === 'Sticker'
      ? attributes.match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*["']([^"']+)["']\s*\})/)
      : attributes.match(/\bmood\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*["']([^"']+)["']\s*\})/);
    const name = literalName?.[1] ?? literalName?.[2] ?? literalName?.[3];
    const heightMatch = attributes.match(/\bsize\s*=\s*(?:\{\s*(\d+(?:\.\d+)?)\s*\}|"(\d+(?:\.\d+)?)")/);
    const hasSize = /\bsize\s*=/.test(attributes);
    const height = heightMatch ? Number(heightMatch[1] ?? heightMatch[2]) : hasSize ? null : 96;
    if (name && height !== null) {
      const key = tag === 'CapybaraMascot' ? `mood-${name}` : name;
      exactHeights.set(key, Math.max(exactHeights.get(key) ?? 0, height));
    } else if (!name && height !== null) dynamicHeight = Math.max(dynamicHeight, height);
    else if (hasSize && height === null) hasUnknownDynamicHeight = true;
  }
}

const maxHeightFor = (name) => {
  // BrandIcon 的尺寸取决于父容器，且数据驱动的贴纸无法从 JSX 静态定到某一张；按任务给的 192 px 保守回退。
  if (name === 'app-icon' || hasUnknownDynamicHeight) return 192;
  return Math.max(exactHeights.get(name) ?? 0, dynamicHeight) || 192;
};
const pngDimensions = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });
const tempRoot = path.join(os.tmpdir(), `shushugo-skins-${process.pid}`);
const qualityRanges = ['60-85', '45-70', '30-60', '20-50'];
const maxBytes = 1_500_000;
const allOutputFiles = [];

try {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const filesBySkin = {};
  for (const [id, skin] of Object.entries(skins)) {
    const outputDir = path.join(outputRoot, id);
    const names = [...skin.names].sort();
    for (const name of names) {
      if (!existsSync(path.join(repo, 'frontend/public/brand', skin.dir, `${name}.png`))) throw new Error(`皮肤原图不存在：${skin.dir}/${name}.png`);
    }
    let totalBytes = 0;
    let selectedQuality = '';
    for (const quality of qualityRanges) {
      rmSync(outputDir, { recursive: true, force: true });
      mkdirSync(outputDir, { recursive: true });
      rmSync(tempRoot, { recursive: true, force: true });
      mkdirSync(tempRoot, { recursive: true });
      totalBytes = 0;
      let passFailed = false;
      try {
        for (const name of names) {
          const source = path.join(repo, 'frontend/public/brand', skin.dir, `${name}.png`);
          const { width, height } = pngDimensions(readFileSync(source));
          const outputHeight = maxHeightFor(name) * 2;
          const outputWidth = Math.round(width * outputHeight / height);
          const resized = path.join(tempRoot, `${id}-${name}.png`);
          const destination = path.join(outputDir, `${name}.png`);
          execFileSync('sips', ['--resampleHeightWidth', String(outputHeight), String(outputWidth), source, '--out', resized], { stdio: 'ignore' });
          execFileSync('pngquant', ['256', '--quality', quality, '--speed', '1', '--force', '--output', destination, resized], { stdio: 'ignore' });
          totalBytes += statSync(destination).size;
        }
      } catch {
        passFailed = true;
      }
      if (!passFailed && totalBytes <= maxBytes) { selectedQuality = quality; break; }
    }
    if (!selectedQuality) throw new Error(`${id} 压缩后为 ${totalBytes} B，超过 ${maxBytes} B 或未达到最低画质`);
    filesBySkin[id] = names;
    allOutputFiles.push(...names.map((name) => path.join(outputDir, `${name}.png`)));
    console.log(`${id}: ${names.length} 张，${totalBytes} B，pngquant ${selectedQuality}; 高度按 JSX 用法 ×2，未知尺寸取 192 px`);
  }

  const hash = createHash('sha256');
  for (const [id, names] of Object.entries(filesBySkin).sort(([a], [b]) => a.localeCompare(b))) {
    for (const name of names) hash.update(`${id}/${name}.png\0`).update(readFileSync(path.join(outputRoot, id, `${name}.png`)));
  }
  const manifest = { version: hash.digest('hex').slice(0, 8), skins: Object.fromEntries(Object.entries(filesBySkin).map(([id, files]) => [id, { files }])) };
  writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest version ${manifest.version}; 总图片 ${allOutputFiles.reduce((sum, filename) => sum + statSync(filename).size, 0)} B`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
