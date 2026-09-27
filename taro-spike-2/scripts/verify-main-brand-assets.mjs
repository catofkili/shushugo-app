import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const frontend = path.join(repo, 'frontend/src');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const routes = require(path.join(root, 'src/platform/route-table.cjs')).ROUTE_TABLE;
const replacements = new Map([
  [path.join(frontend, 'components/CapybaraMascot'), path.join(root, 'src/platform/mascot.weapp.tsx')],
  [path.join(frontend, 'components/AuthDialog'), path.join(frontend, 'components/AuthDialog.weapp.tsx')],
  [path.join(frontend, 'components/ShareImageSheet'), path.join(frontend, 'components/ShareImageSheet.weapp.tsx')],
  [path.join(frontend, 'components/TimerRing'), path.join(frontend, 'components/TimerRing.weapp.tsx')],
  [path.join(frontend, 'pages/NotificationSettings'), path.join(frontend, 'pages/NotificationSettings.weapp.tsx')]
]);
const extensions = ['.tsx', '.ts', '.jsx', '.js', '.cjs', '.mjs'];
const resolveImport = (from, request) => {
  if (!request.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), request);
  if (replacements.has(base)) return replacements.get(base);
  const candidates = path.extname(base) ? [base] : [
    `${base}.weapp.tsx`, `${base}.weapp.ts`, `${base}.weapp.cjs`,
    ...extensions.map((extension) => `${base}${extension}`),
    ...['.tsx', '.ts', '.jsx', '.js'].map((extension) => path.join(base, `index${extension}`))
  ];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
};
const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const assetFromPath = (value) => value.match(/(?:^|\/)(?:brand\/)?(?:sheet\/)?([a-z0-9-]+)\.(?:png|webp)$/i)?.[1] ?? null;
const names = new Map();
const add = (name, file, node) => {
  if (!name || !/^(?:mood|empty|icon|scene|item|roll|card|walk)-[a-z0-9-]+$/i.test(name)) return;
  const line = ts.getLineAndCharacterOfPosition(node.getSourceFile(), node.getStart()).line + 1;
  names.set(name, [...(names.get(name) ?? []), `${path.relative(repo, file)}:${line}`]);
};

const seen = new Set();
const queue = routes.filter((route) => route.tab).map((route) => path.join(root, 'src', `${route.path}.tsx`));
while (queue.length) {
  const file = queue.pop();
  if (!file || seen.has(file) || !fs.existsSync(file) || !/\.(tsx?|jsx?|cjs|mjs)$/.test(file)) continue;
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
      const dependency = resolveImport(file, node.moduleSpecifier.text);
      if (dependency) queue.push(dependency);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require')) {
      const dependency = resolveImport(file, node.arguments[0].text);
      if (dependency) queue.push(dependency);
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : node.tagName.getText(ast);
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const value = literal(attribute.initializer);
        const key = attribute.name.getText(ast);
        if (key === 'name' && /Sticker$/.test(tag)) add(value, file, attribute);
        if (key === 'mood' && /CapybaraMascot$/.test(tag)) add(value && `mood-${value}`, file, attribute);
        if (key === 'src' && value) add(assetFromPath(value), file, attribute);
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && ['brandPath', 'brandAssetUrl', 'stickerUrl'].includes(node.expression.text)) {
      const value = literal(node.arguments[0]);
      if (value) add(assetFromPath(value) ?? value, file, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

const missing = [...names].filter(([name]) => !fs.existsSync(path.join(root, 'src/assets/brand', `${name}.png`)));
if (missing.length) {
  console.error('主包页面引用了未打进主包的贴纸：\n' + missing.map(([name, users]) => `  ${name}: ${users.join(', ')}`).join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ mainStickerNamesChecked: names.size, missing: 0 }));
