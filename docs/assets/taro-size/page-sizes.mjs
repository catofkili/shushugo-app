// 逐页打包（压缩），数据层 frontend/src/lib 视为共享（外部），量每页自身大小与多页共用的组件。
import { build } from '../../../frontend/node_modules/esbuild/lib/main.js';
import { readdirSync } from 'node:fs';
import path from 'node:path';
const FE = new URL('../../../frontend/src', import.meta.url).pathname;
const pages = readdirSync(path.join(FE, 'pages')).filter((f) => f.endsWith('.tsx'));
const shared = { name: 'shared', setup(b) {
  b.onResolve({ filter: /.*/ }, (a) => {
    if (a.kind === 'entry-point') return;
    if (!a.path.startsWith('.')) return { path: a.path, external: true };            // npm 包：react / lucide / capacitor…
    const abs = path.resolve(a.resolveDir, a.path.replace(/\?raw$/, ''));
    if (abs.startsWith(path.join(FE, 'lib') + '/')) return { path: abs, external: true }; // 数据层 → 主包共享
  });
} };
const base = { bundle: true, minify: true, write: false, metafile: true, format: 'esm', platform: 'neutral', jsx: 'automatic',
  loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty', '.webp': 'empty', '.sql': 'text', '.json': 'json' },
  define: { 'import.meta.env': '{}', 'import.meta.url': '""', 'import.meta.hot': 'undefined' }, logLevel: 'silent' };
const users = new Map(); const rows = [];
for (const p of pages) {
  const r = await build({ ...base, entryPoints: [path.join(FE, 'pages', p)], plugins: [shared] });
  const out = r.outputFiles[0].contents.length; const ins = Object.entries(r.metafile.outputs)[0][1].inputs;
  for (const [f, v] of Object.entries(ins)) { if (!users.has(f)) users.set(f, { bytes: v.bytesInOutput, pages: new Set() }); users.get(f).pages.add(p); }
  const big = Object.entries(ins).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 2).map(([f, v]) => `${f.replace(/^.*frontend\/src\//, '')}:${v.bytesInOutput}`);
  rows.push([out, p, big.join('  ')]);
}
rows.sort((a, b) => b[0] - a[0]);
for (const [n, p, b] of rows) console.log(String(n).padStart(8), p.padEnd(28), b);
const sum = rows.reduce((s, r) => s + r[0], 0);
let sharedBytes = 0, uniqueBytes = 0;
for (const v of users.values()) (v.pages.size > 1 ? (sharedBytes += v.bytes) : (uniqueBytes += v.bytes));
console.log(`pages=${rows.length} sum(每页独立打包)=${sum}  其中被≥2页共用的模块(去重)=${sharedBytes}  仅一页用=${uniqueBytes}`);
const top = [...users.entries()].filter(([, v]) => v.pages.size > 1).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 12);
for (const [f, v] of top) console.log('  共用', String(v.bytes).padStart(7), v.pages.size + '页', f.replace(/^.*frontend\/src\//, ''));
