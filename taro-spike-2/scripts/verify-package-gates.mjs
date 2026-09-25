import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const maxBytes = 1_900_000;
// W3 platform storage is still an active parallel line; make this hard after its final merge to taro/main.
const requireNoWebModule = false;
const packages = JSON.parse(fs.readFileSync(path.join(root, 'reports/package-sizes.json'), 'utf8'));
const stats = JSON.parse(fs.readFileSync(path.join(root, 'reports/webpack-stats.json'), 'utf8'));
const roots = Object.keys(packages.packages).filter((name) => name !== 'main');
const owner = (filename) => roots.find((name) => filename === name || filename.startsWith(`${name}/`)) ?? 'main';
const modulePackages = new Map();
const webModules = new Set();

function sourceName(module) {
  return typeof module.nameForCondition === 'string'
    ? module.nameForCondition.replaceAll('\\', '/').replace(/\?.*$/, '')
    : null;
}

function collectModules(module, packageName) {
  const source = sourceName(module);
  if (source) {
    if (!modulePackages.has(source)) modulePackages.set(source, new Set());
    modulePackages.get(source).add(packageName);
    if (/wechat-miniprogram\/src\/shared\/web\.js$/.test(source)) webModules.add(source);
  }
  for (const key of ['modules', 'filteredChildren']) {
    if (Array.isArray(module[key])) for (const child of module[key]) collectModules(child, packageName);
  }
}

function collectWebModules(module) {
  if (!module || typeof module !== 'object') return;
  const source = sourceName(module);
  if (source && /wechat-miniprogram\/src\/shared\/web\.js$/.test(source)) webModules.add(source);
  for (const value of Object.values(module)) {
    if (Array.isArray(value)) value.forEach(collectWebModules);
    else if (value && typeof value === 'object') collectWebModules(value);
  }
}

collectWebModules(stats.modules);

for (const chunk of stats.chunks ?? []) {
  const jsFiles = (chunk.files ?? []).filter((file) => file.endsWith('.js'));
  const chunkPackages = new Set();
  for (const filename of jsFiles) {
    const matches = packages.files
      .filter((file) => file.path === filename || file.path.endsWith(`/${filename}`))
      .map((file) => file.package);
    if (matches.length) matches.forEach((name) => chunkPackages.add(name));
    else chunkPackages.add(owner(filename));
  }
  if (!chunkPackages.size) chunkPackages.add(owner(chunk.names?.[0] ?? 'main'));
  for (const module of chunk.modules ?? []) {
    for (const packageName of chunkPackages) collectModules(module, packageName);
  }
}

const overBudget = Object.entries(packages.packages)
  .filter(([, item]) => item.bytes > maxBytes)
  .map(([name, item]) => ({ name, bytes: item.bytes, overBytes: item.bytes - maxBytes }));
const duplicatedModules = [...modulePackages]
  .filter(([, moduleOwners]) => moduleOwners.size > 1)
  .map(([source, moduleOwners]) => ({ source, packages: [...moduleOwners].sort() }));
const gate = {
  maxBytes,
  packages: Object.fromEntries(Object.entries(packages.packages).map(([name, item]) => [name, {
    bytes: item.bytes,
    passes: item.bytes <= maxBytes
  }])),
  duplicateSourceModuleCount: duplicatedModules.length,
  duplicatedModules,
  webModuleCount: webModules.size,
  webModules: [...webModules],
  webModulePolicy: requireNoWebModule ? 'error' : 'warn until W3 final merge',
  passes: overBudget.length === 0 && duplicatedModules.length === 0 && (!requireNoWebModule || webModules.size === 0)
};
const reportPath = path.join(root, 'reports/package-gates.json');
fs.writeFileSync(reportPath, `${JSON.stringify(gate, null, 2)}\n`);
console.log(JSON.stringify({
  maxBytes,
  overBudget,
  duplicateSourceModuleCount: duplicatedModules.length,
  webModuleCount: webModules.size,
  webModulePolicy: gate.webModulePolicy,
  report: path.relative(root, reportPath)
}, null, 2));

const reportOnly = process.argv.includes('--report-only');
if (!reportOnly && overBudget.length) throw new Error(`分包超出 ${maxBytes} B 上限：${JSON.stringify(overBudget)}`);
if (!reportOnly && duplicatedModules.length) throw new Error(`有源模块出现在多个包：${JSON.stringify(duplicatedModules.slice(0, 10))}`);
if (!reportOnly && requireNoWebModule && webModules.size) throw new Error(`产物包含禁止的 shared/web.js：${[...webModules].join(', ')}`);
