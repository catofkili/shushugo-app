// 小程序把一批网页模块换成了替身。替身是 CommonJS / 另写的 .weapp 实现，webpack 查不出「网页 import 了、替身里没有」的名字——
// 打包照过，真机上一调用就是 `x is not a function`。2026-09-27 组队页就是这样炸的：zoo-sounds 替身没有 playStreakChirp / playSave。
// 这里按 config/index.js 的真实替换顺序，把网页源码里所有「从被替换模块按名导入」的值（类型不算）和替身实际导出的名字对一遍。
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createSharedShims } from '../../wechat-miniprogram/scripts/shared/shims-map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const frontend = path.join(repo, 'frontend');
const require = createRequire(import.meta.url);
const { platformAdapters } = require('../config/platform-adapters.cjs');
const shims = createSharedShims(path.join(repo, 'wechat-miniprogram'));
shims.delete(path.join(frontend, 'src/lib/progress-events'));

// 与 config/index.js 的 NormalModuleReplacementPlugin 同一顺序：适配器 → database/storage 原样 → 吉祥物 → 共享替身。
const replacementFor = (target) => {
  if (platformAdapters.has(target)) return platformAdapters.get(target);
  if (target === path.join(frontend, 'src/lib/database') || target === path.join(frontend, 'src/lib/storage')) return null;
  if (target === path.join(frontend, 'src/components/CapybaraMascot')) return path.join(root, 'src/platform/mascot.weapp.tsx');
  return shims.get(target) ?? null;
};

const sourceOf = (base) => ['.ts', '.tsx', '.js', ''].map((ext) => base + ext).find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
const esmExports = (source) => new Set([
  ...[...source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  ...[...source.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((item) => item.trim().split(/\s+as\s+/).pop()).filter(Boolean))
]);
const typeExports = (source) => new Set([...source.matchAll(/export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));

// 替身里 require 的是打包后的相对路径（../shared/content-store 之类），Node 里解析不到；只关心导出了哪些名字，解析不到的依赖给空壳。
const stub = () => new Proxy(function () {}, { get: (_, key) => (key === Symbol.toPrimitive ? () => '' : stub()), apply: () => stub(), construct: () => stub() });
globalThis.wx ??= stub();
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  try { return originalRequire.call(this, id); } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') return stub();
    throw error;
  }
};
const exportsOf = (file) => /\.(tsx?|mjs)$/.test(file) ? esmExports(fs.readFileSync(file, 'utf8')) : new Set(Object.keys(require(file)));

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) && !/\.weapp\./.test(entry.name)) files.push(full);
  }
};
walk(path.join(frontend, 'src'));

const importPattern = /(?:import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
const wanted = new Map();
for (const file of files) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(importPattern)) {
    if (match[1] || !match[3].startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), match[3]).replace(/\.(tsx?|jsx?|json)$/, '');
    const replacement = replacementFor(target);
    if (!replacement) continue;
    const original = sourceOf(target);
    const types = original ? typeExports(fs.readFileSync(original, 'utf8')) : new Set();
    for (const raw of match[2].split(',')) {
      const item = raw.trim();
      if (!item || item.startsWith('type ')) continue;
      const name = item.split(/\s+as\s+/)[0].trim();
      if (types.has(name)) continue;
      const key = `${target}\0${replacement}`;
      if (!wanted.has(key)) wanted.set(key, new Map());
      const users = wanted.get(key);
      if (!users.has(name)) users.set(name, new Set());
      users.get(name).add(path.relative(repo, file));
    }
  }
}

const missing = [];
for (const [key, names] of wanted) {
  const replacement = key.split('\0')[1];
  const exported = exportsOf(replacement);
  for (const [name, users] of names) {
    if (!exported.has(name)) missing.push(`${path.relative(repo, replacement)} 缺 ${name}（${[...users].join('、')} 在用）`);
  }
}

if (missing.length) {
  console.error('小程序替身缺少网页在用的导出（真机上会是 `x is not a function`）：\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log(JSON.stringify({ replacedModulesChecked: wanted.size, namedImportsChecked: [...wanted.values()].reduce((n, m) => n + m.size, 0), missing: 0 }));
