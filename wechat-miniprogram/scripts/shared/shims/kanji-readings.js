const data = require('./lazy-json')('kanjiReadings');
// esbuild 的 Node 互操作会再包一层 default；两种默认导入都保留同一份活引用。
module.exports = { __esModule: true, default: data, get readings() { return data.readings; } };
