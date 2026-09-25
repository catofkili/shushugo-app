const stores = require('../../wechat-miniprogram/scripts/shared/shims/content-store.js');
const questionMeanings = require('../../wechat-miniprogram/src/content/question-meanings.js');

stores.questionMeanings = questionMeanings;

const ready = async () => undefined;

module.exports = {
  load: async (name) => {
    if (name !== 'questionMeanings') throw new Error(`Taro VocabTestPage does not load ${name}`);
    return questionMeanings;
  },
  ready,
  readyForKanji: ready,
  primeWebLoaders: ready,
  loaded: (name) => name === 'questionMeanings'
};
