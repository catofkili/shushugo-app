import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('../node_modules/typescript');
const terser = require('../node_modules/terser');
const sourcePath = path.resolve(root, '../frontend/src/data/grammar.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let points;

function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'GRAMMAR_POINTS') points = node.initializer;
  ts.forEachChild(node, visit);
}
visit(sourceFile);
if (!points || !ts.isArrayLiteralExpression(points)) throw new Error('grammar.ts: GRAMMAR_POINTS 不是数组字面量');

const groups = [
  { root: 'grammar-foundation', levels: ['N5', 'N4', 'N3'] },
  { root: 'grammar-advanced', levels: ['N2', 'N1'] }
];
const allIds = new Set();
const rows = points.elements.map((entry) => {
  if (!ts.isObjectLiteralExpression(entry)) throw new Error('grammar.ts: grammar point 不是对象字面量');
  const properties = new Map(entry.properties
    .filter((property) => property.name)
    .map((property) => [property.name.text ?? property.name.getText(sourceFile).replaceAll('"', ''), property]));
  const level = properties.get('level')?.initializer?.text;
  const id = properties.get('id')?.initializer?.text;
  if (!level || !id) throw new Error('grammar.ts: grammar point 缺少 level 或 id');
  if (!['N5', 'N4', 'N3', 'N2', 'N1'].includes(level)) throw new Error(`grammar.ts: 未知 JLPT 等级 ${level}`);
  if (allIds.has(id)) throw new Error(`grammar.ts: 重复 id ${id}`);
  allIds.add(id);
  return { entry, level };
});
const report = { sourceBytes: Buffer.byteLength(source), totalEntries: points.elements.length, packages: [] };

for (const group of groups) {
  const entries = rows.filter((row) => group.levels.includes(row.level)).map(({ entry }) => entry.getText(sourceFile));
  const levelCounts = {};
  for (const { level } of rows.filter((row) => group.levels.includes(row.level))) levelCounts[level] = (levelCounts[level] ?? 0) + 1;
  const { code } = await terser.minify(`module.exports={grammarPoints:[${entries.join(',')}]};`, {
    compress: true,
    mangle: true,
    format: { comments: false }
  });
  if (!code) throw new Error(`${group.root}: Terser 没有生成代码`);
  const output = path.join(root, 'dist', group.root, 'grammar.js');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${code}\n`);
  report.packages.push({ root: group.root, levels: group.levels, levelCounts, entries: entries.length, bytes: Buffer.byteLength(code) + 1 });
}

if (allIds.size !== points.elements.length) throw new Error(`grammar.ts: 条目数不匹配 ${allIds.size}/${points.elements.length}`);
const reportPath = path.join(root, 'reports', 'grammar-content.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`语法出厂内容：${report.totalEntries} 条，拆成 ${report.packages.length} 个 JLPT 分包`);
for (const item of report.packages) console.log(`  ${item.root}: ${item.entries} 条，${item.bytes} B，${JSON.stringify(item.levelCounts)}`);
