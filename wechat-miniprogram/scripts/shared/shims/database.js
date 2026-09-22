// frontend/src/lib/database.ts → 小程序的库句柄。
//
// 网页所有模块都从这里拿「当前库」。小程序有几条路要对**另一个**库跑同一套逻辑
// （内容更新时把进度从旧库搬到新库、Node 回归里的临时库），所以多一个 withDatabase：
// 在回调期间把「当前库」临时指向别处。临时库（合并云端快照、导出轻量快照）用同一个
// sql.js 构造器开，不经过 wx / WASM 加载器，Node 回归里也能跑。
let override = null;
const store = () => require('../runtime/database-store');
const current = () => override || store().getDatabase();
const Database = () => current().constructor;
module.exports = {
  getDatabase: current,
  openDatabase: async (bytes) => new (Database())(bytes),
  createDatabase: async () => new (Database())(),
  exportDatabase: () => current().export(),
  initDatabase: async () => current(),
  withDatabase(db, run) {
    const previous = override;
    override = db;
    try { return run(); } finally { override = previous; }
  }
};
