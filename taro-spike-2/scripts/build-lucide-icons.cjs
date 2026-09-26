const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const icons = require('lucide-react');

const names = [
  'AlarmClock', 'AlertTriangle', 'AppWindow', 'Apple', 'ArrowUpRight', 'Bell', 'BellRing', 'BookOpenText', 'Camera',
  'CircleHelp', 'Citrus', 'Cloud', 'Database', 'Download', 'Edit2', 'Heart', 'HelpCircle', 'Info', 'KeyRound',
  'Layers3', 'LetterText', 'ListOrdered', 'LoaderCircle', 'Lock', 'LockKeyhole', 'LogOut', 'Merge', 'Mic', 'Moon',
  'Mountain', 'Music', 'PackageCheck', 'Palette', 'ReceiptText', 'Repeat2', 'ScrollText', 'Send', 'Settings',
  'Shield', 'Shirt', 'SkipForward', 'SlidersHorizontal', 'Smartphone', 'Sun', 'Ticket', 'Trophy', 'Upload',
  'User', 'UserRound',
  'AlertCircle', 'ArrowLeft', 'ArrowLeftRight', 'ArrowRightLeft', 'BookOpenCheck', 'Brain', 'CalendarCheck', 'CalendarDays',
  'Check', 'CheckCircle2', 'ChevronDown', 'ChevronLeft', 'ChevronRight', 'Clock3', 'Crown', 'Eye', 'ExternalLink', 'Flame',
  'FolderPlus', 'GitCompareArrows', 'Handshake', 'History', 'ImageDown', 'Languages', 'Layers', 'ListChecks',
  'Loader2', 'MessageCircle', 'Minus', 'NotebookPen', 'Pause', 'PenLine', 'Pencil', 'PencilLine', 'Play', 'Plus',
  'Puzzle', 'Repeat', 'RotateCcw', 'Search', 'Share2', 'ShieldCheck', 'Shuffle', 'Sparkles', 'Sprout', 'Star',
  'StickyNote', 'Target', 'Timer', 'Trash2', 'Type', 'Undo2', 'Volume2', 'X', 'XCircle', 'RefreshCw'
];
const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');
const frontend = path.join(repo, 'frontend/src');
const routeTable = require(path.join(root, 'src/platform/route-table.cjs')).ROUTE_TABLE;
const mainNames = new Set();
const packageNames = new Map();
const replacements = new Map([
  ['components/AuthDialog', 'components/AuthDialog.weapp.tsx'],
  ['components/Paywall', 'components/Paywall.weapp.tsx'],
  ['components/ShareImageSheet', 'components/ShareImageSheet.weapp.tsx'],
  ['components/TimerRing', 'components/TimerRing.weapp.tsx'],
  ['pages/NotificationSettings', 'pages/NotificationSettings.weapp.tsx']
].map(([from, to]) => [path.join(frontend, from), path.join(frontend, to)]));

function resolveImport(from, request) {
  if (!request.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), request);
  if (replacements.has(base)) return replacements.get(base);
  const extensions = ['.tsx', '.ts', '.jsx', '.js', '.cjs', '.mjs'];
  const candidates = path.extname(base)
    ? [base]
    : [
      `${base}.weapp.tsx`, `${base}.weapp.ts`, `${base}.weapp.cjs`,
      ...extensions.map((extension) => `${base}${extension}`),
      ...['.tsx', '.ts', '.jsx', '.js'].map((extension) => path.join(base, `index${extension}`))
    ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function collectRouteIcons(entry) {
  const seen = new Set();
  const found = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file) || !fs.existsSync(file) || !/\.(tsx?|jsx?|cjs|mjs)$/.test(file)) continue;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
        if (node.moduleSpecifier.text === 'lucide-react') {
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const binding of bindings.elements) if (!binding.isTypeOnly) found.add(binding.propertyName?.text ?? binding.name.text);
          }
        } else {
          const dependency = resolveImport(file, node.moduleSpecifier.text);
          if (dependency) queue.push(dependency);
        }
      } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
        const dependency = resolveImport(file, node.arguments[0].text);
        if (dependency) queue.push(dependency);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

for (const route of routeTable) {
  const entry = path.join(root, 'src', `${route.path}.tsx`);
  const routeIcons = collectRouteIcons(entry);
  if (route.tab) for (const name of routeIcons) mainNames.add(name);
  if (route.subpackage) {
    const packageSet = packageNames.get(route.subpackage) ?? new Set();
    for (const name of routeIcons) packageSet.add(name);
    packageNames.set(route.subpackage, packageSet);
  }
}

const exportMap = new Map([...fs.readFileSync(path.join(root, 'src/platform/lucide.weapp.tsx'), 'utf8').matchAll(/export const (\w+) = icon\('([^']+)'\)/g)].map((match) => [match[1], match[2]]));
const requestedNames = new Set([...mainNames, ...[...packageNames.values()].flatMap((set) => [...set])]);
const normalized = new Map(names.map((name) => [name, name.toLowerCase()]));
for (const name of requestedNames) {
  if (!exportMap.has(name) || !normalized.has(name)) throw new Error(`Lucide 小程序资源缺少导出或生成映射：${name}`);
}

const mainOut = path.join(root, 'src/assets/lucide');
const packageRoot = path.join(root, 'src/package-assets');
fs.rmSync(mainOut, { recursive: true, force: true });
for (const subpackage of ['study', 'account', 'content-pages']) {
  fs.rmSync(path.join(packageRoot, subpackage, 'lucide'), { recursive: true, force: true });
}
fs.mkdirSync(mainOut, { recursive: true });

function writeIcon(name, destination) {
  for (const [variant, color] of [['ink', '#3A2E22'], ['light', '#FFFFFF']]) {
    const markup = renderToStaticMarkup(React.createElement(icons[name], { size: 24, strokeWidth: 2 }))
      .replaceAll('currentColor', color);
    const svg = markup.includes('xmlns=') ? markup : markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    fs.writeFileSync(path.join(destination, `${normalized.get(name)}-${variant}.svg`), `${svg}\n`);
  }
}

for (const name of mainNames) writeIcon(name, mainOut);
const manifest = {};
for (const [subpackage, routeIcons] of packageNames) {
  const onlyInSubpackage = [...routeIcons].filter((name) => !mainNames.has(name));
  if (!onlyInSubpackage.length) continue;
  const destination = path.join(packageRoot, subpackage, 'lucide');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of onlyInSubpackage) {
    writeIcon(name, destination);
    (manifest[normalized.get(name)] ??= []).push(subpackage);
  }
}
fs.writeFileSync(path.join(root, 'src/platform/lucide-packages.cjs'), `module.exports = ${JSON.stringify(manifest, null, 2)};\n`);

const count = mainNames.size + [...packageNames.values()].reduce((total, set) => total + [...set].filter((name) => !mainNames.has(name)).length, 0);
console.log(`已按路由依赖生成 ${count * 2} 个 Lucide SVG（主包 ${mainNames.size * 2} 个）`);
