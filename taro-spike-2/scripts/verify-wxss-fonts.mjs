import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const styles = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.wxss')) styles.push(file);
  }
};

walk(dist);
const failures = [];
for (const file of styles) {
  const css = fs.readFileSync(file, 'utf8');
  const relative = path.relative(dist, file);
  if (/data:(?:font\/|application\/font-)/i.test(css)) failures.push(`${relative}: contains an inlined font`);
  const parsed = postcss.parse(css, { from: relative });
  parsed.walk((node) => {
    const bytes = Buffer.byteLength(node.toString());
    if (bytes > 50_000) failures.push(`${relative}: one CSS rule is ${bytes} B (limit 50000 B)`);
  });
}

for (const name of ['common.wxss', 'app.wxss']) {
  const file = path.join(dist, name);
  console.log(`${name}: ${fs.existsSync(file) ? fs.statSync(file).size : 0} B`);
}
if (failures.length) throw new Error(`WXSS font/rule budget failed:\n${failures.join('\n')}`);
console.log(`WXSS check passed: ${styles.length} files, no local font embeds or rules over 50000 B.`);
