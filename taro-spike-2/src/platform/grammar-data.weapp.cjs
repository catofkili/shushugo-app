const stores = require('../../../wechat-miniprogram/src/shared/content-store.js');
const lazyJson = require('../../../wechat-miniprogram/scripts/shared/shims/lazy-json.js');

// Module scope consumers retain this array before `content.ready()` finishes.
// Keep a proxy over the null sentinel so those references see the loaded rows.
if (stores.grammar === undefined) stores.grammar = null;

module.exports = { grammarPoints: lazyJson('grammar', 'array') };
