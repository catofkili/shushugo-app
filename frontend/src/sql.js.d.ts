declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string, params?: any[]): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  export interface InitSqlJsOptions {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}
