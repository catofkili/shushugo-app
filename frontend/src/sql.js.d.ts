declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string, params?: any[]): QueryExecResult[];
    prepare(sql: string, params?: any[]): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(values?: any[] | Record<string, any>): void;
    /** 绑定 + step + reset。复用同一份已编译的 SQL,批量插入时别用 Database.run。 */
    run(values?: any[] | Record<string, any>): void;
    step(): boolean;
    get(): any[];
    getAsObject(): Record<string, any>;
    reset(): void;
    free(): boolean;
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
