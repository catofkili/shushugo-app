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
  questionMeanings: '../content/question-meanings.js',
  kanjiUnitRuntime: '../content/kanji-unit-runtime.js',
  distinctionReviews: '../features/content/distinction-reviews.js',
  kanjiReadingUsage: '../features/content/kanji-reading-usage.js',
  kanjiVariants: '../features/content/kanji-variants.js',
  kanjiReadings: '../features/content/kanji-readings.js',
  grammarKeyPoints: '../features/content/grammar-key-points.js'
};

const loading = {};

function load(name) {
  if (stores[name]) return Promise.resolve(stores[name]);
  if (!SOURCES[name]) return Promise.reject(new Error(`未知内容包 ${name}`));
  loading[name] ||= (typeof require.async === 'function' ? require.async(SOURCES[name]) : Promise.resolve(require(SOURCES[name])))
    .then((mod) => { stores[name] = mod && mod.__esModule && mod.default ? mod.default : mod; return stores[name]; })
    .catch((error) => { delete loading[name]; throw error; });
  return loading[name];
}

/** 学习相关页面开门前等这一下：题面层、辨析注记、汉字变体 / 读音、语法抓手。 */
function ready() {
  return Promise.all(['questionMeanings', 'distinctionReviews', 'kanjiVariants', 'kanjiReadings', 'grammarKeyPoints'].map(load)).then(() => undefined);
}

/** 混合学习里的汉字卡还要汉字单元索引和一字多音表。 */
function readyForKanji() {
  return ready().then(() => Promise.all(['kanjiUnitRuntime', 'kanjiReadingUsage'].map(load))).then(() => undefined);
}

module.exports = { load, ready, readyForKanji, loaded: (name) => Boolean(stores[name]) };
