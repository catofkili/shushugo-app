import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'src');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else files.push({ path: path.relative(root, target), bytes: fs.statSync(target).size });
  }
}

walk(sourceRoot);
const total = files.reduce((sum, file) => sum + file.bytes, 0);
const mainLimit = 2 * 1024 * 1024;
const aggregateLimit = 30 * 1024 * 1024;
const appConfig = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'app.json'), 'utf8'));
const subpackageRoots = (appConfig.subPackages || appConfig.subpackages || []).map((entry) => String(entry.root).replace(/^\/+|\/+$/g, ''));
const packageFor = (file) => subpackageRoots.find((rootName) => file.path === `src/${rootName}` || file.path.startsWith(`src/${rootName}/`)) || 'main';
const packages = Object.fromEntries(['main', ...subpackageRoots].map((name) => [name, { bytes: 0, files: 0 }]));
for (const file of files) {
  const name = packageFor(file);
  packages[name].bytes += file.bytes;
  packages[name].files += 1;
}
const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
const forbidden = files.filter((file) => /nihongo\.db|jlpt_words_seed\.json|audio\//.test(file.path));

if (total > aggregateLimit) throw new Error(`代码包超过 30 MiB：${total}`);
for (const [name, info] of Object.entries(packages)) {
  if (info.bytes > mainLimit) throw new Error(`${name === 'main' ? '主包' : `分包 ${name}`} 超过 2 MiB：${info.bytes}`);
}
if (forbidden.length) throw new Error(`大内容误入代码包：${forbidden.map((file) => file.path).join(', ')}`);

console.log(JSON.stringify({
  ok: true,
  totalBytes: total,
  totalMiB: Number((total / 1024 / 1024).toFixed(3)),
  packages: Object.fromEntries(Object.entries(packages).map(([name, info]) => [name, {
    ...info,
    miB: Number((info.bytes / 1024 / 1024).toFixed(3))
  }])),
  mainLimitMiB: 2,
  aggregateLimitMiB: 30,
  largest
}, null, 2));
