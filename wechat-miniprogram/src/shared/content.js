/*
 * 出厂内容数据的装载器。这些数据太大，不进主包，放在 content / features 两个分包里；
 * 主包里的 web.js 通过 shims/content-store 按需读，这里负责把分包模块灌进去。
 *
 * ⚠️ 灌入之前 web.js 会退化（题面退回 words.meaning 的清洗、辨析注记为空），所以
 * 学习页 / 辨析页 / 语法页在 onLoad 里先 `await content.ready()`。
 * require.async 要基础库 2.24.3+（2022 年）；Node 回归里没有它，退回同步 require。
 */
const stores = require('./content-store');

const SOURCES = {
  questionMeanings: () => require.async('../content/question-meanings.js'),
  kanjiUnitRuntime: () => require.async('../content/kanji-unit-runtime.js'),
  distinctionReviews: () => require.async('../features/content/distinction-reviews.js'),
  kanjiReadingUsage: () => require.async('../content/kanji-reading-usage.js'),
  kanjiVariants: () => require.async('../features/content/kanji-variants.js'),
  kanjiReadings: () => require.async('../features/content/kanji-readings.js'),
  grammarKeyPoints: () => require.async('../features/content/grammar-key-points.js'),
  pitchAccent: () => require.async('../content/pitch-accent.js')
};

// Node 回归没有 require.async；动态 require 只在 Node 分支用，避免微信把同步依赖提进主包。
const NODE_SOURCES = {
  questionMeanings: '../content/question-meanings.js',
  kanjiUnitRuntime: '../content/kanji-unit-runtime.js',
  distinctionReviews: '../features/content/distinction-reviews.js',
  kanjiReadingUsage: '../content/kanji-reading-usage.js',
  kanjiVariants: '../features/content/kanji-variants.js',
  kanjiReadings: '../features/content/kanji-readings.js',
  grammarKeyPoints: '../features/content/grammar-key-points.js',
  pitchAccent: '../content/pitch-accent.js'
};

const loading = {};

function load(name) {
  if (stores[name]) return Promise.resolve(stores[name]);
  if (!SOURCES[name]) return Promise.reject(new Error(`未知内容包 ${name}`));
  // 微信编译器只收集字面量路径；require.async(变量) 在模拟器里会报 module is not defined。
  loading[name] ||= (typeof require.async === 'function' ? SOURCES[name]() : Promise.resolve(require(NODE_SOURCES[name])))
    .then((mod) => { stores[name] = mod && mod.__esModule && mod.default ? mod.default : mod; return stores[name]; })
    .catch((error) => { delete loading[name]; throw error; });
  return loading[name];
}

/** 学习相关页面开门前等这一下：题面层、辨析注记、汉字变体 / 读音、语法抓手。 */
function ready() {
  return Promise.all(['questionMeanings', 'distinctionReviews', 'kanjiVariants', 'kanjiReadings', 'grammarKeyPoints', 'pitchAccent'].map(load)).then(() => undefined);
}

/** 混合学习里的汉字卡还要汉字单元索引和一字多音表。 */
function readyForKanji() {
  return ready().then(() => Promise.all(['kanjiUnitRuntime', 'kanjiReadingUsage'].map(load))).then(() => primeWebLoaders());
}

/*
 * 网页那几个模块自己也有一层缓存（loadPitchAccent / loadKanjiReadings / loadKanjiUnitIndex /
 * loadKanjiReadingUsage 都是 `loading ??= import(...)`），数据灌进 content-store 之后
 * 还要把这一层点一下，它们才会把表真正 decode 出来。
 * ⚠️ 顺序不能反：先灌 store 再调 loader。反了的话 loader 会拿不到数据而抛错，
 * 而那个 rejected promise 被缓存住 —— 之后永远失败，音高重音和汉字卡整个不出现。
 */
function primeWebLoaders() {
  const web = require('./web');
  return Promise.all([
    web.pitchAccent.loadPitchAccent(),
    web.furiganaSplit.loadKanjiReadings(),
    web.kanjiUnitIndex.loadKanjiUnitIndex(),
    web.kanjiReadingUsage ? web.kanjiReadingUsage.loadKanjiReadingUsage() : Promise.resolve()
  ]).then(() => undefined);
}

module.exports = { load, ready, readyForKanji, primeWebLoaders, loaded: (name) => Boolean(stores[name]) };
