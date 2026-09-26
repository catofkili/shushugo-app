import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const expected = [
  './account/fflate.umd.js',
  './content/question-meanings.js',
  './content/kanji-unit-runtime.js',
  './features/content/distinction-reviews.js',
  './content/kanji-reading-usage.js',
  './features/content/kanji-variants.js',
  './features/content/kanji-readings.js',
  './features/content/grammar-key-points.js',
  './content/pitch-accent.js',
  './grammar-foundation/grammar.js',
  './grammar-advanced/grammar.js'
];
const calls = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(filename);
    else if (entry.name.endsWith('.js')) {
      const relative = path.relative(dist, filename).split(path.sep).join('/');
      const source = fs.readFileSync(filename, 'utf8');
      if (source.includes('__non_webpack_require__')) throw new Error(`${relative}: __non_webpack_require__ 未转换成微信 require.async`);
      for (const match of source.matchAll(/require\.async\(\s*(['"])([^'"]+)\1\s*\)/g)) {
        const request = match[2];
        if (request.startsWith('/')) throw new Error(`${relative}: 禁止绝对路径 require.async(${JSON.stringify(request)})`);
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), request));
        if (target === '..' || target.startsWith('../')) throw new Error(`${relative}: require.async(${JSON.stringify(request)}) 越出 dist`);
        if (!fs.existsSync(path.join(dist, ...target.split('/')))) throw new Error(`${relative}: require.async(${JSON.stringify(request)}) -> dist/${target} 不存在`);
        calls.push({ caller: relative, request, target });
      }
    }
  }
}

visit(dist);
const found = new Set(calls.map((call) => call.request));
const missing = expected.filter((request) => !found.has(request));
if (missing.length) throw new Error(`require.async 未覆盖 ${missing.length} 个目标: ${missing.join(', ')}`);
if (!calls.length) throw new Error('构建产物里没有 require.async 调用');
for (const call of calls) {
  const sourcePath = call.request.includes('/features/content/')
    ? path.join(root, '../wechat-miniprogram/src/features/content', path.basename(call.request))
    : call.request.includes('/grammar-')
      ? null
      : call.request.includes('/account/')
        ? null
        : path.join(root, '../wechat-miniprogram/src/content', path.basename(call.request));
  if (sourcePath && fs.existsSync(sourcePath)
    && !fs.readFileSync(path.join(dist, ...call.target.split('/'))).equals(fs.readFileSync(sourcePath))) {
    throw new Error(`${call.caller}: dist/${call.target} 与原始出厂内容不同，疑似被 Webpack 编译或改写`);
  }
}

const fflate = await import(pathToFileURL(path.join(dist, 'account/fflate.umd.js')).href);
const fflateApi = fflate.default ?? fflate;
const sample = new TextEncoder().encode('snapshot gzip smoke');
if (Buffer.compare(Buffer.from(sample), Buffer.from(fflateApi.gunzipSync(fflateApi.gzipSync(sample))))) {
  throw new Error('account/fflate.umd.js gzip round-trip failed');
}

const result = { expectedTargetCount: expected.length, callCount: calls.length, resolvedTargetCount: found.size, calls };
const report = path.join(root, 'reports/require-async-paths.json');
fs.writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`);
console.log(`require.async 路径校验通过：${calls.length} 次调用，${found.size} 个独立目标；${expected.length} 个目标模块均存在。`);
for (const call of calls) console.log(`  ${call.caller} -> ${call.request} -> dist/${call.target}`);
