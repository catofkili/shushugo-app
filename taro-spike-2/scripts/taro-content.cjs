// Match the native Mini Program loader: async module load -> content-store ->
// prime Web loaders. Keep every require.async path literal for WeChat's analyzer.
const stores = require('../../wechat-miniprogram/src/shared/content-store.js');

const SOURCES = {
  questionMeanings: () => __non_webpack_require__.async('../../content/question-meanings.js'),
  kanjiUnitRuntime: () => __non_webpack_require__.async('../../content/kanji-unit-runtime.js'),
  distinctionReviews: () => __non_webpack_require__.async('../../features/content/distinction-reviews.js'),
  kanjiReadingUsage: () => __non_webpack_require__.async('../../content/kanji-reading-usage.js'),
  kanjiVariants: () => __non_webpack_require__.async('../../features/content/kanji-variants.js'),
  kanjiReadings: () => __non_webpack_require__.async('../../features/content/kanji-readings.js'),
  grammarKeyPoints: () => __non_webpack_require__.async('../../features/content/grammar-key-points.js'),
  pitchAccent: () => __non_webpack_require__.async('../../content/pitch-accent.js')
};

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

function load(name) {
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

function ready() {
  return Promise.all(['questionMeanings', 'distinctionReviews', 'kanjiVariants', 'kanjiReadings', 'grammarKeyPoints', 'pitchAccent'].map(load)).then(() => undefined);
}

function readyForKanji() {
  return ready().then(() => Promise.all(['kanjiUnitRuntime', 'kanjiReadingUsage'].map(load))).then(() => primeWebLoaders());
}

function primeWebLoaders() {
  const web = require('../../wechat-miniprogram/src/shared/web.js');
  return Promise.all([
    web.pitchAccent.loadPitchAccent(),
    web.furiganaSplit.loadKanjiReadings(),
    web.kanjiUnitIndex.loadKanjiUnitIndex(),
    web.kanjiReadingUsage ? web.kanjiReadingUsage.loadKanjiReadingUsage() : Promise.resolve()
  ]).then(() => undefined);
}

module.exports = { load, ready, readyForKanji, primeWebLoaders, loaded: (name) => Boolean(stores[name]) };
