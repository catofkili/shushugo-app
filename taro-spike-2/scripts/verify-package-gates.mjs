import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');
const dist = path.join(root, 'dist');
const maxBytes = 1_900_000;
const maxUnapprovedPageComponentBytes = 100_000;
const coreModule = (source) => /(?:\/frontend\/src\/lib\/|\/node_modules\/ts-fsrs\/)/.test(source);
const pageComponent = (source) => /\/frontend\/src\/(?:components|pages)\//.test(source);
const relativeSource = (source) => path.relative(repoRoot, source).split(path.sep).join('/');
const allowedCoreDuplicates = {
  'frontend/src/lib/vocab-test.ts': 'Question selection and scoring are calculated on demand; active sessions live in the shared database, not a module cache.',
  'frontend/src/lib/conjugation-explanation.ts': 'Conjugation explanations are derived from static verb-pair hints; the module keeps no user-data cache.',
  'frontend/src/lib/analytics/weekly.ts': 'Weekly metrics are calculated from query results on demand; no user records are cached in the module.',
  'frontend/src/lib/analytics/weekly-reports.ts': 'Reports are read from and written to the shared database on each call; the module keeps no report snapshot.',
  'frontend/src/lib/speech.weapp.ts': 'Only public voice-index content and package-local audio handles are cached; user preferences are read live and no study data is cached.',
  'frontend/src/lib/platform-dialogs.weapp.ts': 'Confirmation and prompt results are returned per call from wx.showModal; this wrapper retains no user data or mutable module state.',
  'frontend/src/lib/share-canvas.weapp.ts': 'The canvas and file sequence are temporary rendering state scoped to a page bundle, not persisted user data.',
  'frontend/src/lib/token-dictionary.ts': 'Dictionary matches are computed from the supplied database rows; results are not retained in a module cache.',
  'frontend/src/lib/share-image.weapp.ts': 'Share and save operations use the image passed to each call and retain no mutable user state.',
  'frontend/src/lib/distinction-quiz.ts': 'Question groups and results are derived from the shared database on demand; there is no module-level user-data cache.',
  'frontend/src/lib/grammarProgressPreferences.ts': 'The WeakSet records only an idempotent legacy-migration marker per DB object; position values remain in the shared database.',
  'frontend/src/lib/study-clock.ts': 'Timer state is passed immutably between calls and belongs to the mounted page, not a module singleton.',
  'frontend/src/lib/useStudyTimer.ts': 'Timer state and intervals belong to each mounted React hook instance; no shared module state is retained.',
  'frontend/src/lib/grammar-form-target.ts': 'Grammar form matching is a pure calculation over the supplied grammar point.',
  'frontend/src/lib/grammar-title-furigana.ts': 'Memoized values are deterministic lookups over bundled title-furigana content, not user data.',
  'frontend/src/lib/grammar-key-points.ts': 'The module reads bundled grammar key-point content and retains no mutable user state.',
  'frontend/src/lib/study-totals.ts': 'Study totals are queried from the shared database on demand; query results are not cached.',
  'frontend/src/lib/grammar-numbering.ts': 'Ordinal maps are derived only from bundled grammar records and are safe package-local content caches.',
  'frontend/src/lib/yield-to-paint.ts': 'The helper schedules a paint yield and retains no state.',
  'frontend/src/lib/grammarNotes.ts': 'Notes are read from and written to app-wide localStorage on every call; this module has no in-memory note cache.'
};
// Route components can appear in lazy tabs and route subpackages after splitting;
// accept only this reviewed file set and fail on new or stale duplicate entries.
const allowedPageComponentDuplicates = {
  'frontend/src/pages/Library.tsx': 'The grammar tab and grammar library subpackage each render this route from their isolated package graphs.',
  'frontend/src/pages/ConfusionPage.tsx': 'The study quiz and grammar subpackage include this route in separate package entry graphs.',
  'frontend/src/components/GrammarTermHint.weapp.tsx': 'Grammar term hints are rendered by both the lazy tab chunk and grammar/content routes (W6 weapp variant).',
  'frontend/src/components/grammar-term-hint-data.ts': 'Shared data for the GrammarTermHint weapp variant; duplicated alongside it.',
  'frontend/src/pages/ImmersiveGrammar.tsx': 'The tab bundle and grammar subpackage each contain this independently reachable route.',
  'frontend/src/components/DailyPlanPanel.tsx': 'The study tab and account routes render this panel from isolated package graphs.',
  'frontend/src/pages/GrammarFoundationPage.tsx': 'Grammar foundation navigation reaches this page from both content and grammar entry graphs.',
  'frontend/src/pages/FavoritesPage.tsx': 'Favorites is reachable from both the content and grammar package entry graphs.',
  'frontend/src/components/GrammarHighlightProvider.tsx': 'Each package needs a provider for its local React tree; its user-data cache is pinned once in main.',
  'frontend/src/components/DailyPlanRing.weapp.tsx': 'The study and account routes each render the Canvas ring (W6 weapp variant) in separate package entry graphs.',
  'frontend/src/components/daily-plan-ring-geometry.ts': 'Ring geometry shared by the Canvas ring; duplicated alongside it.',
  'frontend/src/components/JapaneseRuby.tsx': 'Ruby rendering is shared by the lazy tab chunk and independently loaded content/grammar routes.',
  'frontend/src/components/TokenDictionaryPopover.weapp.tsx': 'The dictionary popover is used by lazy tabs and independently loaded grammar/content routes.',
  'frontend/src/components/FloatingDoodlePen.weapp.tsx': 'The annotation control is used by the grammar subpackage and lazy grammar interface.',
  'frontend/src/pages/GrammarDetail.tsx': 'Grammar detail is reachable through both content and grammar route packages.',
  'frontend/src/components/FavoriteFolderPicker.tsx': 'The folder picker is shared by study, content, grammar, and lazy tab routes.',
  'frontend/src/components/ShareImageSheet.weapp.tsx': 'The share sheet is rendered by study, content, and lazy tab routes in their own package graphs.',
  'frontend/src/components/GrammarPointPopover.tsx': 'Grammar point previews are used by lazy tabs and content/grammar routes.',
  'frontend/src/components/ProReadingPreview.tsx': 'The study and lazy tab routes each render the reading preview.',
  'frontend/src/components/ExampleSentence.tsx': 'Example sentences are rendered from both content and grammar route packages.',
  'frontend/src/components/JapaneseWordRuby.tsx': 'Word ruby rendering is used in the study, grammar, and lazy tab routes.',
  'frontend/src/components/ReviewButton.tsx': 'Review controls appear in the content and grammar route packages.',
  'frontend/src/components/DailyPlanSlider.weapp.tsx': 'The account and study routes each render their package-local slider.',
  'frontend/src/components/Disclosure.weapp.tsx': 'Zoo, grammar, account, and study pages render this small disclosure in isolated package graphs; open state belongs to each mounted control and no user data is cached.',
  'frontend/src/components/JapaneseRubyText.weapp.tsx': 'Ruby text is used by lazy tabs and independently loaded content/grammar routes.'
};
const packages = JSON.parse(fs.readFileSync(path.join(root, 'reports/package-sizes.json'), 'utf8'));
const stats = JSON.parse(fs.readFileSync(path.join(root, 'reports/webpack-stats.json'), 'utf8'));
const roots = Object.keys(packages.packages).filter((name) => name !== 'main');
const owner = (filename) => roots.find((name) => filename === name || filename.startsWith(`${name}/`)) ?? 'main';
const modulePackages = new Map();
const moduleSizes = new Map();
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
    moduleSizes.set(source, Math.max(moduleSizes.get(source) ?? 0, module.size ?? 0));
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
  .map(([source, moduleOwners]) => ({ source, bytes: moduleSizes.get(source) ?? 0, packages: [...moduleOwners].sort() }))
  .sort((a, b) => b.bytes - a.bytes);
const duplicatedCoreModules = duplicatedModules.filter(({ source }) => coreModule(source));
const duplicatedPageComponents = duplicatedModules.filter(({ source }) => pageComponent(source));
const duplicatedPageComponentBytes = duplicatedPageComponents.reduce((sum, item) => sum + item.bytes, 0);
const currentCorePaths = new Set(duplicatedCoreModules.map(({ source }) => relativeSource(source)));
const currentPagePaths = new Set(duplicatedPageComponents.map(({ source }) => relativeSource(source)));
const unapprovedCoreDuplicates = duplicatedCoreModules.filter(({ source }) => !allowedCoreDuplicates[relativeSource(source)]);
const staleCoreAllowlist = Object.keys(allowedCoreDuplicates).filter((source) => !currentCorePaths.has(source));
const unapprovedPageComponents = duplicatedPageComponents.filter(({ source }) => !allowedPageComponentDuplicates[relativeSource(source)]);
const stalePageComponentAllowlist = Object.keys(allowedPageComponentDuplicates).filter((source) => !currentPagePaths.has(source));
const unapprovedPageComponentBytes = unapprovedPageComponents.reduce((sum, item) => sum + item.bytes, 0);
const grammarHighlights = [...modulePackages].find(([source]) => /\/frontend\/src\/lib\/grammarHighlights\.ts$/.test(source));
const grammarHighlightsPackages = grammarHighlights ? [...grammarHighlights[1]].sort() : [];
const grammarHighlightsPinned = grammarHighlightsPackages.length === 1 && grammarHighlightsPackages[0] === 'main';
const coreDuplicateReasons = Object.fromEntries(duplicatedCoreModules.map((item) => [
  relativeSource(item.source), allowedCoreDuplicates[relativeSource(item.source)] ?? 'UNAPPROVED: add a source-specific reason only after verifying its module state.'
]));
const pageComponentDuplicateReasons = Object.fromEntries(duplicatedPageComponents.map((item) => [
  relativeSource(item.source), allowedPageComponentDuplicates[relativeSource(item.source)] ?? 'UNAPPROVED: add a source-specific reason only after verifying its package use.'
]));
const mainTopModules = [...modulePackages]
  .filter(([, moduleOwners]) => moduleOwners.has('main'))
  .map(([source]) => ({ source, bytes: moduleSizes.get(source) ?? 0 }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 10);
const gate = {
  maxBytes,
  packages: Object.fromEntries(Object.entries(packages.packages).map(([name, item]) => [name, {
    bytes: item.bytes,
    passes: item.bytes <= maxBytes
  }])),
  maxUnapprovedPageComponentBytes,
  duplicateSourceModuleCount: duplicatedModules.length,
  duplicatedModules,
  duplicatedCoreModuleCount: duplicatedCoreModules.length,
  duplicatedCoreModules: duplicatedCoreModules.map((item) => ({ ...item, source: relativeSource(item.source), reason: coreDuplicateReasons[relativeSource(item.source)] })),
  coreDuplicateReasons,
  unapprovedCoreDuplicates: unapprovedCoreDuplicates.map((item) => relativeSource(item.source)),
  staleCoreAllowlist,
  grammarHighlightsPackages,
  grammarHighlightsPinned,
  duplicatedPageComponents: duplicatedPageComponents.map((item) => ({ ...item, source: relativeSource(item.source), reason: pageComponentDuplicateReasons[relativeSource(item.source)] })),
  pageComponentDuplicateReasons,
  duplicatedPageComponentBytes,
  unapprovedPageComponents: unapprovedPageComponents.map((item) => relativeSource(item.source)),
  stalePageComponentAllowlist,
  unapprovedPageComponentBytes,
  pageComponentAllowlistPasses: !unapprovedPageComponents.length && !stalePageComponentAllowlist.length
    && unapprovedPageComponentBytes <= maxUnapprovedPageComponentBytes,
  webModuleCount: webModules.size,
  webModules: [...webModules],
  webModulePolicy: 'error',
  mainTopModules,
  passes: overBudget.length === 0 && !unapprovedCoreDuplicates.length && !staleCoreAllowlist.length
    && grammarHighlightsPinned && !unapprovedPageComponents.length && !stalePageComponentAllowlist.length
    && unapprovedPageComponentBytes <= maxUnapprovedPageComponentBytes && webModules.size === 0
};
const reportPath = path.join(root, 'reports/package-gates.json');
fs.writeFileSync(reportPath, `${JSON.stringify(gate, null, 2)}\n`);
console.log(JSON.stringify({
  maxBytes,
  overBudget,
  duplicateSourceModuleCount: duplicatedModules.length,
  duplicatedCoreModuleCount: duplicatedCoreModules.length,
  unapprovedCoreDuplicateCount: unapprovedCoreDuplicates.length,
  staleCoreAllowlistCount: staleCoreAllowlist.length,
  grammarHighlightsPinned,
  duplicatedPageComponentBytes,
  unapprovedPageComponentCount: unapprovedPageComponents.length,
  stalePageComponentAllowlistCount: stalePageComponentAllowlist.length,
  maxUnapprovedPageComponentBytes,
  maxUnapprovedPageComponentBytes,
  webModuleCount: webModules.size,
  webModulePolicy: gate.webModulePolicy,
  passes: gate.passes,
  report: path.relative(root, reportPath)
}, null, 2));

const reportOnly = process.argv.includes('--report-only');
if (!reportOnly && overBudget.length) throw new Error(`分包超出 ${maxBytes} B 上限：${JSON.stringify(overBudget)}`);
if (!reportOnly && (unapprovedCoreDuplicates.length || staleCoreAllowlist.length)) throw new Error(`核心模块重复允许清单不匹配：未允许 ${JSON.stringify(unapprovedCoreDuplicates.map(({ source }) => relativeSource(source)))}；已过期 ${JSON.stringify(staleCoreAllowlist)}`);
if (!reportOnly && !grammarHighlightsPinned) throw new Error(`grammarHighlights 必须只存在于主包，当前包：${JSON.stringify(grammarHighlightsPackages)}`);
if (!reportOnly && (unapprovedPageComponents.length || stalePageComponentAllowlist.length || unapprovedPageComponentBytes > maxUnapprovedPageComponentBytes)) throw new Error(`页面组件重复清单不匹配：未允许 ${JSON.stringify(unapprovedPageComponents.map(({ source }) => relativeSource(source)))}；已过期 ${JSON.stringify(stalePageComponentAllowlist)}；未允许重复 ${unapprovedPageComponentBytes} B / ${maxUnapprovedPageComponentBytes} B`);
if (!reportOnly && webModules.size) throw new Error(`产物包含禁止的 shared/web.js：${[...webModules].join(', ')}`);
