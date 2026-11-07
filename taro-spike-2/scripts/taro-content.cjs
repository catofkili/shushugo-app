// Match the native Mini Program loader: async module load -> content-store ->
// prime Web loaders. Keep every require.async path literal for WeChat's analyzer.
const stores = require('../../wechat-miniprogram/src/shared/content-store.js');
const pitchAccent = require('../../frontend/src/lib/pitch-accent');
const furigana = require('../../frontend/src/lib/furigana');
const kanjiUnitIndex = require('../../frontend/src/lib/kanji-unit-index');
const kanjiReadingUsage = require('../../frontend/src/lib/kanji-reading-usage');
if (stores.grammar === undefined) stores.grammar = null;

const SOURCES = {
  questionMeanings: () => __non_webpack_require__.async('./content/question-meanings.js'),
  kanjiUnitRuntime: () => __non_webpack_require__.async('./content/kanji-unit-runtime.js'),
  distinctionReviews: () => __non_webpack_require__.async('./features/content/distinction-reviews.js'),
  kanjiReadingUsage: () => __non_webpack_require__.async('./content/kanji-reading-usage.js'),
  kanjiVariants: () => __non_webpack_require__.async('./features/content/kanji-variants.js'),
  kanjiReadings: () => __non_webpack_require__.async('./features/content/kanji-readings.js'),
  grammarKeyPoints: () => __non_webpack_require__.async('./features/content/grammar-key-points.js'),
  pitchAccent: () => __non_webpack_require__.async('./content/pitch-accent.js')
};

const GRAMMAR_SOURCES = [
  () => __non_webpack_require__.async('./grammar-foundation/grammar.js'),
  () => __non_webpack_require__.async('./grammar-advanced/grammar.js')
];
const NODE_GRAMMAR_SOURCES = ['../dist/grammar-foundation/grammar.js', '../dist/grammar-advanced/grammar.js'];

const NODE_SOURCES = {
  questionMeanings: '../../wechat-miniprogram/src/content/question-meanings.js',
  kanjiUnitRuntime: '../../wechat-miniprogram/src/content/kanji-unit-runtime.js',
  distinctionReviews: '../../wechat-miniprogram/src/features/content/distinction-reviews.js',
  kanjiReadingUsage: '../../wechat-miniprogram/src/content/kanji-reading-usage.js',
  kanjiVariants: '../../wechat-miniprogram/src/features/content/kanji-variants.js',
  kanjiReadings: '../../wechat-miniprogram/src/features/content/kanji-readings.js',
  grammarKeyPoints: '../../wechat-miniprogram/src/features/content/grammar-key-points.js',
  pitchAccent: '../../wechat-miniprogram/src/content/pitch-accent.js'
};

const loading = {};

// Prime the same lazy stores after we have hydrated content-store. These are
// the source loaders used by the web app; importing the native content loader
// here would also import its bundled web.js graph into the Taro main package.
const WEB_LOADERS = {
  pitchAccent: () => pitchAccent.loadPitchAccent(),
  kanjiReadings: () => furigana.loadKanjiReadings(),
  kanjiUnitIndex: () => kanjiUnitIndex.loadKanjiUnitIndex(),
  kanjiReadingUsage: () => kanjiReadingUsage.loadKanjiReadingUsage()
};

function primeWebLoaders(names = Object.keys(WEB_LOADERS)) {
  return Promise.all(names.map((name) => WEB_LOADERS[name]())).then(() => undefined);
}

function load(name) {
  if (name === 'grammar') return loadGrammar();
  if (stores[name]) return Promise.resolve(stores[name]);
  if (!SOURCES[name]) return Promise.reject(new Error(`未知内容包 ${name}`));
  loading[name] ||= Promise.resolve().then(() => {
    if (typeof __non_webpack_require__ === 'function' && typeof __non_webpack_require__.async === 'function') {
      return SOURCES[name]();
    }
    return module.require(NODE_SOURCES[name]);
  }).then((mod) => {
    stores[name] = mod && mod.__esModule && mod.default ? mod.default : mod;
    return stores[name];
  }).catch((error) => {
    delete loading[name];
    throw error;
  });
  return loading[name];
}

function loadGrammar() {
  if (stores.grammar) return Promise.resolve(stores.grammar);
  loading.grammar ||= Promise.resolve()
    .then(() => typeof __non_webpack_require__ === 'function' && typeof __non_webpack_require__.async === 'function'
      ? Promise.all(GRAMMAR_SOURCES.map((source) => source()))
      : NODE_GRAMMAR_SOURCES.map((source) => module.require(source)))
    .then((modules) => Promise.all(modules))
    .then(([foundation, advanced]) => {
      stores.grammar = [...foundation.grammarPoints, ...advanced.grammarPoints];
      return stores.grammar;
    })
    .catch((error) => {
      delete loading.grammar;
      throw error;
    });
  return loading.grammar;
}

function ready() {
  return Promise.all(['questionMeanings', 'distinctionReviews', 'kanjiVariants', 'kanjiReadings', 'grammar', 'grammarKeyPoints', 'pitchAccent'].map(load)).then(() => undefined);
}

function readyForKanji() {
  return Promise.all(['kanjiUnitRuntime', 'kanjiReadingUsage', 'kanjiReadings'].map(load))
    .then(() => primeWebLoaders(['kanjiUnitIndex', 'kanjiReadingUsage', 'kanjiReadings']));
}

const PAGE_CONTENT = {
  // grammarKeyPoints：混合学习的语法插播用同一张 GrammarCard，翻面要读抓手。2026-10-09 真机漏了它，
  // 没进过语法页就翻插播卡，抓手拿到的是未加载的懒代理，渲染直接崩、整页按钮失灵。
  'word-study': ['questionMeanings', 'distinctionReviews', 'kanjiVariants', 'kanjiReadings', 'grammarKeyPoints', 'pitchAccent'],
  'vocab-test': ['questionMeanings', 'kanjiVariants', 'kanjiReadings'],
  'confusion-quiz': ['questionMeanings', 'distinctionReviews', 'kanjiVariants', 'kanjiReadings'],
  'kanji-reading': ['kanjiUnitRuntime', 'kanjiReadingUsage', 'kanjiReadings'],
  'grammar-quiz': ['grammar', 'grammarKeyPoints', 'kanjiReadings']
};
const PAGE_WEB_LOADERS = {
  'word-study': ['pitchAccent', 'kanjiReadings'],
  'vocab-test': ['kanjiReadings'],
  'confusion-quiz': ['kanjiReadings'],
  'kanji-reading': ['kanjiUnitIndex', 'kanjiReadingUsage', 'kanjiReadings'],
  'grammar-quiz': ['kanjiReadings']
};

function readyForPage(page) {
  const names = PAGE_CONTENT[page];
  if (!names) return Promise.reject(new Error(`未知页面内容声明 ${page}`));
  return Promise.all(names.map(load)).then(() => primeWebLoaders(PAGE_WEB_LOADERS[page]));
}

function readyForHomeMode(mode) {
  const names = mode === 'mixed' ? ['kanjiUnitRuntime', 'kanjiReadingUsage', 'distinctionReviews']
    : mode === 'kanji' ? ['kanjiUnitRuntime'] : [];
  return Promise.all(names.map(load)).then(() => primeWebLoaders(
    mode === 'mixed' ? ['kanjiUnitIndex', 'kanjiReadingUsage'] : mode === 'kanji' ? ['kanjiUnitIndex'] : []
  ));
}

function readyForRoute(page, mode = 'classic') {
  if (page === 'home') return readyForHomeMode(mode);
  if (page === 'word') return Promise.all([readyForPage('word-study'), readyForHomeMode(mode)]);
  if (page === 'quick-study') return readyForPage('word-study');
  if (page === 'vocab-test') return readyForPage('vocab-test');
  if (['confusion', 'distinction-quiz'].includes(page)) return readyForPage('confusion-quiz');
  if (page === 'kanji-readings') return readyForKanji();
  if (['grammar', 'detail', 'grammar-foundation', 'favorites'].includes(page)) return readyForPage('grammar-quiz');
  if (['jlpt-plan', 'settings'].includes(page)) return readyForHomeMode('mixed');
  return Promise.resolve();
}

const ROUTED_PAGES = new Set(['home', 'word', 'quick-study', 'vocab-test', 'confusion', 'distinction-quiz', 'kanji-readings',
  'grammar', 'detail', 'grammar-foundation', 'favorites', 'jlpt-plan', 'settings']);

// 页面挂载闸门。readyForRoute 只认上面声明过的页面；其余页面（词库、错题本、拼写、集中拿下……）
// 照 T1 之前的做法装齐 word-study + 汉字内容：代理未就绪会抛错，漏声明的页面宁可多等也不能崩。
// 导航本身不走这里（不让点按等下载），等待只发生在目标页的 StartupLoading 里。
function readyForPageMount(page, mode = 'classic') {
  return ROUTED_PAGES.has(page) ? readyForRoute(page, mode)
    : Promise.all([readyForPage('word-study'), readyForKanji()]).then(() => undefined);
}

module.exports = { load, ready, readyForKanji, readyForPage, readyForHomeMode, readyForRoute, readyForPageMount, primeWebLoaders, loaded: (name) => Boolean(stores[name]) };
