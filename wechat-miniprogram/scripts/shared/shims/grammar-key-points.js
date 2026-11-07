const data = require('./lazy-json')('grammarKeyPoints');
module.exports = { __esModule: true, default: data,
  get points() { return data.points; }, get aliases() { return data.aliases; }, get kanji() { return data.kanji; }
};
