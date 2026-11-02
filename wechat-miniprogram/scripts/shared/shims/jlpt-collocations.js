// import() 只在版本落后时执行；每次调用都走可重试 loader，不缓存失败的 Promise。
module.exports = () => require('../shared/content').load('jlptCollocations');
