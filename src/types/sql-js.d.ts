declare module "sql.js" {
  type SqlJsConfig = {
    wasmBinary?: ArrayBuffer | Uint8Array;
    locateFile?: (file: string) => string;
  };

  const initSqlJs: (config?: SqlJsConfig) => Promise<any>;

  export default initSqlJs;
}

declare module "sql.js/dist/sql-asm.js" {
  import initSqlJs from "sql.js";

  export default initSqlJs;
}
