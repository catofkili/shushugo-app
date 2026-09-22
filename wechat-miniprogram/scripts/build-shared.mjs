/*
 * 把 frontend/src/lib 原样打成小程序能 require 的文件。
 *
 * 为什么不再手抄一份：小程序此前的调度 / 收藏 / 成就 / 词汇量 / 周报都是「照着网页重写」，
 * 结果表名（achievement_unlocked vs achievements）、判据（成就 stats 一半字段写死 0）、
 * 算法（词汇量没有猜测修正、可信度换成正确率）各自漂移 —— 而这些表全是跨端同步的，
 * 小程序写出来的行会原样出现在网页和 App 里。同一份源码编出来，就不会再漂。
 * 用户 2026-09-22 定的规则：除了微信自己的机制和组队，一切按网页。
 *
 * 产物：
 *  - src/shared/web.js                       主包。入口清单 scripts/shared/entry.ts。
 *  - src/content/question-meanings.js        content 分包：人工题面层（1 MB）
 *  - src/features/content/distinction-reviews.js   features 分包：辨析审校（数据 + 函数）
 *  - src/content/kanji-unit-runtime.js             content 分包：汉字单元索引
 *  - src/features/content/kanji-reading-usage.js   features 分包：一字多音说明表
 *  - data/grammar_ids.json                    grammar_points.id ↔ grammar.ts 字符串 id
 *  分包里的三份由 src/shared/content.js 用 require.async 灌进 shims/content-store.js。
 *
 * 规则：
 *  - 需要平台能力的模块用 SHIMS 表换成小程序自己的实现（库句柄、落盘、权益、正字法数据…），
 *    shim 里对 ../runtime ../core ../data ../vendor 的 require 保持字面量，运行时从 src/shared/ 相对解析。
 *  - 出厂种子（jlpt_words_seed 等）换成一访问就抛错的守卫：内容走下载的 nihongo.db，迁移只在网页跑。
 *  - localStorage / window / document 由 scripts/shared/polyfill.js 提供替身（内联在 web.js 顶部）。
 *  - 产物必须提交；`npm run check-shared` 会重新构建一次比对，漂了就拒绝。
 *
 * 用法：node scripts/build-shared.mjs [--check]
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const frontend = path.resolve(root, '../frontend');
const lib = path.join(frontend, 'src/lib');
const data = path.join(frontend, 'src/data');
const shims = path.join(root, 'scripts/shared/shims');
const { build } = require(path.join(frontend, 'node_modules/esbuild/lib/main.js'));
const checkOnly = process.argv.includes('--check');

const HEADER = '/* 由 scripts/build-shared.mjs 从 frontend/src 生成，别手改；改网页那份再重跑。 */\n';
const shim = (name) => path.join(shims, name);

// 网页模块路径（不带扩展名）→ shim 文件
const SHIMS = {
  [`${lib}/database`]: shim('database.js'),
  [`${lib}/storage`]: shim('storage.js'),
  [`${lib}/entitlements`]: shim('entitlements.js'),
  [`${lib}/progress-events`]: shim('progress-events.js'),
  [`${lib}/orthography`]: shim('orthography.js'),
  [`${lib}/zoo-sounds`]: shim('zoo-sounds.js'),
  [`${lib}/models/question-meaning-overrides`]: shim('question-meaning-overrides.js'),
  [`${path.join(frontend, 'src/components/CapybaraMascot')}`]: shim('mascot.js'),
  // 出厂内容数据：小程序已有同名数据模块的换过去；大的进分包按需灌；只给卡面用的小份直接打进来。
  [`${data}/verb_pair_hints`]: shim('verb-pair-hints.js'),
  [`${data}/confusion_distinction_reviews`]: shim('distinction-reviews.js'),
  [`${data}/kanji_reading_unit_runtime`]: shim('kanji-unit-runtime.js'),
  [`${data}/kanji_reading_usage`]: shim('kanji-reading-usage.js'),
  [`${data}/kanji_variants`]: shim('kanji-variants.js'),
  [`${data}/kanji_readings`]: shim('kanji-readings.js'),
  [`${data}/grammar_key_points`]: shim('grammar-key-points.js'),
  // 出厂种子只给迁移用，小程序不迁移。
  [`${data}/jlpt_words_seed`]: shim('seed-guard.js'),
  [`${data}/grammar_seed`]: shim('seed-guard.js'),
  [`${data}/jlpt_meaning_overrides`]: shim('seed-guard.js'),
  [`${data}/jlpt_example_overrides`]: shim('seed-guard.js'),
  [`${data}/jlpt_collocation_content`]: shim('seed-guard.js'),
  [`${data}/jlpt_level_overrides`]: shim('seed-guard.js'),
  [`${data}/kana_reading_fixes`]: shim('seed-guard.js'),
  [`${data}/dictionary_supplement_seed`]: shim('seed-guard.js'),
  [`${data}/word_sense_keys`]: shim('seed-guard.js')
};
// 允许直接打进主包的 src/data JSON（都不大）
const INLINE_DATA = new Set(['english_origins.json']);

const plugin = {
  name: 'shushugo-shims',
  setup(api) {
    api.onResolve({ filter: /^\.\.?\// }, (args) => {
      const target = path.resolve(args.resolveDir, args.path).replace(/\.(ts|tsx|js|json)$/, '').replace(/\?raw$/, '');
      return SHIMS[target] ? { path: SHIMS[target] } : null;
    });
    // shim 里对小程序自身模块的引用保持原样，运行时从 src/shared/ 相对解析
    api.onResolve({ filter: /^\.\.\/(runtime|core|data|vendor|shared)\// }, (args) => (
      args.importer.startsWith(shims) ? { path: args.path, external: true } : null
    ));
    api.onResolve({ filter: /^ts-fsrs$/ }, () => ({ path: '../vendor/ts-fsrs.umd', external: true }));
    api.onResolve({ filter: /^(lucide-react|react|react-dom|@capacitor\/.*|@aparajita\/.*)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    api.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = new Proxy({}, { get: (_t, p) => p === "__esModule" ? false : () => ({}) });', loader: 'js' }));
  }
};

const common = {
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2020',
  write: false,
  metafile: true,
  logLevel: 'warning',
  legalComments: 'none',
  plugins: [plugin],
  loader: { '.sql': 'text' },
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.MODE': '"production"',
    'import.meta.env.BASE_URL': '"/"',
    'import.meta.env.VITE_SYNC_API_URL': '""',
    'import.meta.env.VITE_AUDIO_BASE_URL': '""'
  }
};

const outputs = new Map(); // 产物路径 → 内容

// ---- 主包：src/shared/web.js ----
const main = await build({ ...common, entryPoints: [path.join(root, 'scripts/shared/entry.ts')] });
const mainInputs = Object.values(main.metafile.outputs)[0].inputs;
const leaked = Object.keys(mainInputs).filter((file) => /src\/data\/.*\.json$/.test(file) && !INLINE_DATA.has(path.basename(file)));
if (leaked.length) throw new Error(`出厂内容 JSON 进了主包共享层：${leaked.join(', ')}`);
const polyfill = fs.readFileSync(path.join(root, 'scripts/shared/polyfill.js'), 'utf8');
outputs.set('src/shared/web.js', HEADER + polyfill + '\n' + main.outputFiles[0].text);
// 内容存储必须是同一个模块实例：web.js 里的 shim 和 src/shared/content.js 都 require('../shared/content-store')
outputs.set('src/shared/content-store.js', HEADER + fs.readFileSync(shim('content-store.js'), 'utf8'));

// ---- 分包内容 ----
const jsonModule = (file) => HEADER + 'module.exports = ' + JSON.stringify(JSON.parse(fs.readFileSync(path.join(data, file), 'utf8'))) + ';\n';
outputs.set('src/content/question-meanings.js', jsonModule('question_meaning_overrides.json'));
outputs.set('src/content/kanji-unit-runtime.js', jsonModule('kanji_reading_unit_runtime.json'));
outputs.set('src/features/content/kanji-reading-usage.js', jsonModule('kanji_reading_usage.json'));
outputs.set('src/features/content/kanji-variants.js', jsonModule('kanji_variants.json'));
outputs.set('src/features/content/kanji-readings.js', jsonModule('kanji_readings.json'));
outputs.set('src/features/content/grammar-key-points.js', jsonModule('grammar_key_points.json'));
const reviews = await build({ ...common, entryPoints: [path.join(data, 'confusion_distinction_reviews.ts')] });
outputs.set('src/features/content/distinction-reviews.js', HEADER + reviews.outputFiles[0].text);

// ---- grammar_points.id == grammar.ts 的 bookOrder（verify-release-db 钉着）↔ 字符串 id ----
const grammarSource = fs.readFileSync(path.join(frontend, 'src/data/grammar.ts'), 'utf8');
const grammarIds = {};
for (const match of grammarSource.matchAll(/"id":\s*"(pdf-[^"]+)"[\s\S]*?"bookOrder":\s*(\d+)/g)) grammarIds[match[2]] = match[1];
if (Object.keys(grammarIds).length < 700) throw new Error(`grammar.ts 里只解析出 ${Object.keys(grammarIds).length} 条 id`);
outputs.set('data/grammar_ids.json', JSON.stringify(grammarIds) + '\n');

// ---- 体积闸门 ----
const kib = (text) => Buffer.byteLength(text) / 1024;
const LIMITS = { 'src/shared/web.js': Number(process.env.SHARED_LIMIT_KIB || 700), 'src/content/question-meanings.js': 1400, 'src/features/content/distinction-reviews.js': 420, 'src/content/kanji-unit-runtime.js': 640, 'src/features/content/kanji-reading-usage.js': 400 };
const largestMain = () => Object.entries(mainInputs).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 12)
  .map(([file, info]) => `${(info.bytesInOutput / 1024).toFixed(0).padStart(4)} KiB ${path.relative(frontend, file)}`).join('\n');
for (const [file, limit] of Object.entries(LIMITS)) {
  if (kib(outputs.get(file)) > limit) console.error(largestMain());
  if (kib(outputs.get(file)) > limit) throw new Error(`${file} ${kib(outputs.get(file)).toFixed(0)} KiB，超过 ${limit} KiB；先看 metafile 里谁把内容数据带进来了`);
}

// ---- 写出 / 比对 ----
let stale = [];
for (const [file, text] of outputs) {
  const target = path.join(root, file);
  if (checkOnly) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) stale.push(file);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}
if (checkOnly) {
  if (stale.length) {
    console.error(`共享层产物与 frontend/src 不一致：${stale.join(', ')}\n运行 node scripts/build-shared.mjs && npm run build-data`);
    process.exit(1);
  }
  console.log(`OK shared bundle is fresh (web.js ${kib(outputs.get('src/shared/web.js')).toFixed(0)} KiB)`);
} else {
  const largest = Object.entries(mainInputs).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 8)
    .map(([file, info]) => `${(info.bytesInOutput / 1024).toFixed(0).padStart(4)} KiB ${path.relative(frontend, file)}`);
  for (const [file, text] of outputs) console.log(`wrote ${file} (${kib(text).toFixed(0)} KiB)`);
  console.log(largest.join('\n'));
}
