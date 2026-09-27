import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const config = JSON.parse(fs.readFileSync(path.join(out, 'app.json'), 'utf8'));
const roots = (config.subPackages ?? config.subpackages ?? []).map((pkg) => pkg.root);
const packages = new Map([['main', 0], ...roots.map((pkg) => [pkg, 0])]);
const files = [];
function visit(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, item.name);
    if (item.isDirectory()) visit(filename);
    else {
      const relative = path.relative(out, filename).split(path.sep).join('/');
      const owner = roots.find((pkg) => relative === pkg || relative.startsWith(`${pkg}/`)) ?? 'main';
      const bytes = fs.statSync(filename).size;
      packages.set(owner, (packages.get(owner) ?? 0) + bytes);
      files.push({ path: relative, package: owner, bytes });
    }
  }
}
visit(out);

const result = {
  limitBytes: 2 * 1024 * 1024,
  packages: Object.fromEntries([...packages].map(([name, bytes]) => [name, {
    bytes, mib: Number((bytes / 1024 / 1024).toFixed(3)), passes: bytes <= 2 * 1024 * 1024
  }])),
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  files: files.sort((a, b) => b.bytes - a.bytes)
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/package-sizes.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  packages: result.packages,
  totalBytes: result.totalBytes,
  largestFiles: result.files.slice(0, 12)
}, null, 2));
