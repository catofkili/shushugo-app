const initSqlJs = require('../vendor/sql-wasm.js');

const WASM_PATH = '/assets/sql-wasm.wasm';
let sqlPromise;

function instantiateWasm(imports, done) {
  const wasmApi = globalThis.WXWebAssembly;
  if (!wasmApi || typeof wasmApi.instantiate !== 'function') {
    throw new Error('当前环境没有 WXWebAssembly.instantiate；请使用微信开发者工具或真机调试');
  }

  // WXWebAssembly 只接受代码包内路径。sql.js 的 instantiateWasm 注入口
  // 需要在 Promise 完成后把 Instance 交回 Emscripten glue；兼容不同基础库
  // 返回 { instance, module } 或直接返回 Instance 的形状。
  wasmApi.instantiate(WASM_PATH, imports).then((result) => {
    const instance = result?.instance ?? result;
    if (!instance || !instance.exports) throw new Error('WXWebAssembly 未返回有效 WebAssembly.Instance');
    done(instance, result?.module);
  }).catch((error) => {
    console.error('[sqlite] WXWebAssembly.instantiate failed', error);
    throw error;
  });

  // sql.js 会等待 callback；返回空对象符合 Emscripten instantiateWasm 约定。
  return {};
}

function loadSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: () => WASM_PATH,
      instantiateWasm
    });
  }
  return sqlPromise;
}

async function openDatabase(bytes) {
  const SQL = await loadSql();
  return new SQL.Database(bytes ? new Uint8Array(bytes) : undefined);
}

function validateDatabase(db) {
  const requiredTables = ['words', 'progress', 'app_state'];
  const rows = db.exec(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => '?').join(', ')})`,
    requiredTables
  );
  const names = new Set(rows[0]?.values?.map((row) => String(row[0])) ?? []);
  const missing = requiredTables.filter((table) => !names.has(table));
  if (missing.length) throw new Error(`不是收集日数据库，缺少表：${missing.join(', ')}`);
  const wordCount = db.exec('SELECT COUNT(*) FROM words')[0]?.values?.[0]?.[0] ?? 0;
  if (Number(wordCount) <= 0) throw new Error('数据库没有词条');
}

function ensureWordFsrsColumns(db) {
  const columns = new Set(
    db.exec('PRAGMA table_info(progress)')[0]?.values?.map((row) => String(row[1])) ?? []
  );
  const required = [
    ['fsrs_stability', 'REAL'],
    ['fsrs_difficulty', 'REAL'],
    ['fsrs_due', 'TEXT'],
    ['fsrs_last_review', 'TEXT'],
    ['fsrs_state', 'INTEGER'],
    ['fsrs_steps', 'INTEGER'],
    ['fsrs_reps', 'INTEGER'],
    ['fsrs_lapses', 'INTEGER']
  ];
  for (const [name, type] of required) {
    if (!columns.has(name)) db.run(`ALTER TABLE progress ADD COLUMN ${name} ${type}`);
  }
}

async function openAndValidate(bytes) {
  const db = await openDatabase(bytes);
  try {
    validateDatabase(db);
    // 现有种子库会由 iOS 启动迁移补上 FSRS 列；小程序必须保持同构，
    // 因此在打开每一份本地库后执行同一组幂等迁移。
    ensureWordFsrsColumns(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = {
  loadSql,
  openAndValidate,
  openDatabase,
  validateDatabase,
  ensureWordFsrsColumns
};
