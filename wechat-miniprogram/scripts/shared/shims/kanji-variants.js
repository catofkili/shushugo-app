const data = require('./lazy-json')('kanjiVariants');
module.exports = { __esModule: true, default: data, get japanese_to_simplified() { return data.japanese_to_simplified; } };
