import initSqlJs, { Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;
let sqlModulePromise: ReturnType<typeof initSqlJs> | null = null;

const REQUIRED_BACKUP_TABLES = ["words", "progress", "app_state"];

const validateAppDatabase = (candidate: Database): void => {
  const placeholders = REQUIRED_BACKUP_TABLES.map(() => "?").join(", ");
  const result = candidate.exec(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
    REQUIRED_BACKUP_TABLES
  );
  const names = new Set(result[0]?.values.map((row) => String(row[0])) ?? []);
  const missing = REQUIRED_BACKUP_TABLES.filter((table) => !names.has(table));
  if (missing.length) {
    throw new Error(`Invalid ShuShuGo backup. Missing tables: ${missing.join(", ")}`);
  }
};

const loadSqlModule = () => {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({ locateFile: () => wasmUrl });
  }
  return sqlModulePromise;
};

export async function initDatabase(): Promise<Database> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 初始化 sql.js
      const SQL = await loadSqlModule();

      // 加载数据库文件
      const response = await fetch('/nihongo.db');
      if (!response.ok) {
        throw new Error('Failed to load database');
      }

      const buffer = await response.arrayBuffer();
      db = new SQL.Database(new Uint8Array(buffer));

      console.log('✅ Database initialized');
      return db;
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * 在不替换当前应用数据库的情况下打开一个临时数据库。
 * 同步合并需要同时读取“本机”和“云端”两份 SQLite,不能通过 importDatabase
 * 先替换全局实例,否则合并失败时会把当前进度弄丢。
 */
export async function openDatabase(data: Uint8Array): Promise<Database> {
  const SQL = await loadSqlModule();
  return new SQL.Database(data);
}

/** 创建不含出厂词典的临时 SQLite，用于生成轻量云同步快照。 */
export async function createDatabase(): Promise<Database> {
  const SQL = await loadSqlModule();
  return new SQL.Database();
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// 导出数据库到文件（用于保存学习进度）
export function exportDatabase(): Uint8Array | null {
  if (!db) return null;
  return db.export();
}

// 从文件恢复数据库（用于恢复学习进度）
export async function importDatabase(data: Uint8Array, options: { validateBackup?: boolean } = {}): Promise<void> {
  const imported = await openDatabase(data);
  if (options.validateBackup) {
    validateAppDatabase(imported);
  }
  db = imported;
  console.log('✅ Database imported');
}
