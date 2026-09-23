// 自他动词对（77 KiB）：网页在模块初始化时 Object.entries() 就把它展开成常量，
// 所以**不能懒加载**（懒代理那一刻还没有键，展开出来就是空表且永远不会好）。
// 留在主包里，和小程序其它 data 模块一起由 build-data-modules 生成。
module.exports = require('../data/verb_pair_hints');
