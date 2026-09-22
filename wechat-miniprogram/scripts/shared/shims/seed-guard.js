// 出厂词典 / 语法种子（jlpt_words_seed 12 MB、grammar_seed 1 MB…）绝不进小程序：内容走下载的
// nihongo.db（runtime/content-update.js）。study-core 里引用它们的只有 ensureSeedData 一族迁移，
// 小程序不调用；万一哪条路径碰到，这里当场抛错，好过拿一份空种子把 grammar_points 删光。
module.exports = new Proxy({}, {
  get(_target, prop) {
    if (prop === '__esModule') return false;
    if (typeof prop === 'symbol') return undefined;
    throw new Error(`出厂种子数据不在小程序包里（访问了 ${String(prop)}）：内容迁移只在网页 / App 上跑`);
  }
});
