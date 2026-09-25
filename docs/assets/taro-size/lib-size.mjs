// 所有页面用到的 frontend/src/lib（传递闭包）打成一份压缩包：主包里的共享数据层有多大、同步带了哪些大数据。
import { build } from '../../../frontend/node_modules/esbuild/lib/main.js';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const FE = new URL('../../../frontend/src', import.meta.url).pathname;
const pages = readdirSync(path.join(FE, 'pages')).filter((f) => f.endsWith('.tsx'));
// 先收集页面直接/间接引用到的 lib 入口
const libEntries = new Set();
const collect = { name: 'c', setup(b) { b.onResolve({ filter: /.*/ }, (a) => {
  if (a.kind === 'entry-point') return;
  if (!a.path.startsWith('.')) return { path: a.path, external: true };
  const abs = path.resolve(a.resolveDir, a.path.replace(/\?raw$/, ''));
  if (abs.startsWith(path.join(FE, 'lib') + '/')) { libEntries.add(abs); return { path: abs, external: true }; }
}); } };
const common = { bundle: true, minify: true, write: false, metafile: true, format: 'esm', platform: 'neutral', jsx: 'automatic',
  loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty', '.webp': 'empty', '.sql': 'text', '.json': 'json' },
  define: { 'import.meta.env': '{}', 'import.meta.url': '""', 'import.meta.hot': 'undefined' }, logLevel: 'silent' };
for (const p of pages) await build({ ...common, entryPoints: [path.join(FE, 'pages', p)], plugins: [collect] });
const entry = path.join((await import('node:os')).tmpdir(), 'lib-entry.ts');
writeFileSync(entry, [...libEntries].map((f, i) => `export * as m${i} from ${JSON.stringify(f)};`).join('\n'));
const npmExt = { name: 'n', setup(b) { b.onResolve({ filter: /^[^./]/ }, (a) => (/^ts-fsrs/.test(a.path) ? undefined : { path: a.path, external: true })); } };
const r = await build({ ...common, entryPoints: [entry], plugins: [npmExt], nodePaths: [new URL('../../../frontend/node_modules', import.meta.url).pathname] });
const ins = Object.entries(Object.values(r.metafile.outputs)[0].inputs);
const total = r.outputFiles[0].contents.length;
const data = ins.filter(([f]) => /src\/data\//.test(f)).reduce((s, [, v]) => s + v.bytesInOutput, 0);
console.log(`lib 入口 ${libEntries.size} 个；共享数据层一份（压缩）= ${total} B，其中 src/data 同步数据 = ${data} B，代码 ≈ ${total - data} B`);
for (const [f, v] of ins.sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 14)) console.log(String(v.bytesInOutput).padStart(9), f.replace(/^.*frontend\//, ''));
