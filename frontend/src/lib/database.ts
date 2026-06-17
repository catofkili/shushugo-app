import initSqlJs, { Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

export async function initDatabase(): Promise<Database> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 初始化 sql.js
      const SQL = await initSqlJs({
        locateFile: () => wasmUrl,
      });

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
export async function importDatabase(data: Uint8Array): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: () => wasmUrl,
  });
  db = new SQL.Database(data);
  console.log('✅ Database imported');
}
