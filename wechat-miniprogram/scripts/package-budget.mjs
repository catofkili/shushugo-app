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
const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
const forbidden = files.filter((file) => /nihongo\.db|jlpt_words_seed\.json|audio\//.test(file.path));

if (total > aggregateLimit) throw new Error(`代码包超过 30 MiB：${total}`);
if (forbidden.length) throw new Error(`大内容误入代码包：${forbidden.map((file) => file.path).join(', ')}`);

console.log(JSON.stringify({
  ok: total <= mainLimit,
  totalBytes: total,
  totalMiB: Number((total / 1024 / 1024).toFixed(3)),
  mainLimitMiB: 2,
  aggregateLimitMiB: 30,
  largest
}, null, 2));

if (total > mainLimit) {
  console.error('WARN 主包估算超过 2 MiB；接入 Taro 后需要按启动页/学习页拆分分包。');
  process.exitCode = 1;
}
