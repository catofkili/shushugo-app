// 标签页（主页/单词/语法/我的）+ 它们带起来的数据层，压缩后多大；>100KB 的出厂数据按异步内容处理（不计入）。
import { build } from '../../../frontend/node_modules/esbuild/lib/main.js';
import { statSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const FE = new URL('../../../frontend/src', import.meta.url).pathname;
const plug = { name: 'p', setup(b) { b.onResolve({ filter: /.*/ }, (a) => {
  if (a.kind === 'entry-point') return;
  if (!a.path.startsWith('.') && !a.path.startsWith('/')) return /^ts-fsrs/.test(a.path) ? undefined : { path: a.path, external: true };
  const abs = path.resolve(a.resolveDir, a.path.replace(/\?raw$/, ''));
  for (const ext of ['', '.ts', '.tsx', '.json', '.js']) { try { if (abs.includes('/src/data/') && statSync(abs + ext).isFile() && statSync(abs + ext).size > 100_000) return { path: abs, external: true }; } catch {} }
}); } };
const common = { bundle: true, minify: true, write: false, metafile: true, format: 'esm', platform: 'neutral', jsx: 'automatic',
  nodePaths: [new URL('../../../frontend/node_modules', import.meta.url).pathname],
  loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty', '.webp': 'empty', '.sql': 'text', '.json': 'json' },
  define: { 'import.meta.env': '{}', 'import.meta.url': '""', 'import.meta.hot': 'undefined' }, logLevel: 'silent' };
const run = async (label, files) => {
  const e = path.join((await import('node:os')).tmpdir(), `taro-size-entry-${label}.ts`);
  writeFileSync(e, files.map((f, i) => `export * as x${i} from ${JSON.stringify(path.join(FE, f))};`).join('\n'));
  const r = await build({ ...common, entryPoints: [e], plugins: [plug] });
  const ins = Object.entries(Object.values(r.metafile.outputs)[0].inputs);
  const part = (re) => ins.filter(([f]) => re.test(f)).reduce((s, [, v]) => s + v.bytesInOutput, 0);
  console.log(label.padEnd(10), 'total', r.outputFiles[0].contents.length, '| lib', part(/src\/lib\//), '| data(≤100K)', part(/src\/data\//), '| 页面+组件', part(/src\/(pages|components|features|hooks)\//), '| ts-fsrs', part(/ts-fsrs/));
};
await run('home', ['components/ZooHome.tsx']);
await run('tabs', ['components/ZooHome.tsx', 'pages/WordStudy.tsx', 'pages/Library.tsx', 'pages/ProfilePage.tsx']);
await run('all', readdirSync(path.join(FE, 'pages')).filter((f) => f.endsWith('.tsx')).map((f) => 'pages/' + f).concat('components/ZooHome.tsx'));
