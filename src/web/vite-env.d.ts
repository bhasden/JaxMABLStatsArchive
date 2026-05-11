/// <reference types="vite/client" />

declare module "sql.js" {
  export type QueryExecResult = {
    columns: string[];
    values: unknown[][];
  };

  export type Database = {
    exec(sql: string): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  };

  export type SqlJsStatic = {
    Database: new (data?: Uint8Array) => Database;
  };

  export default function initSqlJs(options?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
