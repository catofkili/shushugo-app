// 出厂内容不进 webpack：dist/content/ 是一个独立分包，文件由 copy 原样放过去，
// 运行时用微信自己的 require.async（分包异步化）去读。__non_webpack_require__ 输出成裸 require。
const stores = require('../../wechat-miniprogram/scripts/shared/shims/content-store.js');

const loading = {};
function load(name) {
  if (name !== 'questionMeanings') return Promise.reject(new Error(`Taro VocabTestPage does not load ${name}`));
  if (stores[name]) return Promise.resolve(stores[name]);
  loading[name] ||= __non_webpack_require__.async('../../content/question-meanings.js')
    .then((mod) => (stores[name] = mod && mod.default ? mod.default : mod));
  return loading[name];
}
const ready = () => load('questionMeanings').then(() => undefined);

module.exports = { load, ready, readyForKanji: ready, primeWebLoaders: ready, loaded: (name) => Boolean(stores[name]) };
