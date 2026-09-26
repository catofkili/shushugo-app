import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.isFile() && file.endsWith('.js')) files.push(file);
  }
}

await collect(root);
const issues = [];
const directWorkerRequest = /(?:fetch|downloadFile|request)\s*\(\s*(['"`])https?:\/\/[^/'"`]+/g;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(directWorkerRequest)) {
    issues.push(`${path.relative(root, file)}: ${match[0]}`);
  }
  if (/https:\/\/api\.shushugo\.com/.test(source)) {
    issues.push(`${path.relative(root, file)}: contains the Worker origin`);
  }
}

if (issues.length) {
  console.error(`发现小程序产物直接访问 Worker / 外部 HTTPS 域名：\n${issues.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`云函数网络检查通过：扫描 ${files.length} 个 JS 文件；没有 Worker 主机名或直接 HTTPS 请求。`);
}
