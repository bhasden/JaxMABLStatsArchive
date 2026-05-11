import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

let db: Database | undefined;

function respond(id: number, result: unknown) {
  self.postMessage({ id, ok: true, result });
}

function fail(id: number, error: unknown) {
  self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
}

self.onmessage = async (event: MessageEvent<{ id: number; type: string; bytes?: Uint8Array; sql?: string }>) => {
  const { id, type } = event.data;

  try {
    if (type === "load") {
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      db?.close();
      db = new SQL.Database(event.data.bytes);
      respond(id, undefined);
      return;
    }

    if (!db) {
      throw new Error("Archive database is not loaded yet.");
    }

    if (type === "exec") {
      respond(id, db.exec(event.data.sql ?? ""));
      return;
    }

    if (type === "export") {
      respond(id, db.export());
      return;
    }

    throw new Error(`Unknown worker message: ${type}`);
  } catch (error) {
    fail(id, error);
  }
};
