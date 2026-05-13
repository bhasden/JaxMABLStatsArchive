export type QueryResult = {
  columns: string[];
  values: unknown[][];
};

export type QueryHistoryEntry = {
  id: string;
  sql: string;
  source: "page" | "explorer";
  label?: string;
  ranAt: string;
  rowCount?: number;
};

export type ArchiveDbSnapshot = {
  bytes: Uint8Array;
  modified: boolean;
  savedAt: string;
  sourceHash?: string;
};

const DB_NAME = "jax-mabl-archive";
const DB_VERSION = 1;
const STORE = "kv";
const WORKING_DB_KEY = "working-db";
const HISTORY_KEY = "query-history";

function openArchiveStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readValue<T>(key: string): Promise<T | undefined> {
  const db = await openArchiveStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function writeValue(key: string, value: unknown) {
  const db = await openArchiveStore();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadWorkingDb() {
  return readValue<ArchiveDbSnapshot>(WORKING_DB_KEY);
}

export async function saveWorkingDb(snapshot: ArchiveDbSnapshot) {
  await writeValue(WORKING_DB_KEY, snapshot);
}

export async function resetWorkingDb(bytes: Uint8Array, sourceHash?: string) {
  await saveWorkingDb({
    bytes,
    modified: false,
    savedAt: new Date().toISOString(),
    sourceHash,
  });
}

export async function hashBytes(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function loadQueryHistory() {
  return (await readValue<QueryHistoryEntry[]>(HISTORY_KEY)) ?? [];
}

export async function appendQueryHistory(entry: Omit<QueryHistoryEntry, "id" | "ranAt">) {
  const history = await loadQueryHistory();
  const next: QueryHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    ranAt: new Date().toISOString(),
  };
  await writeValue(HISTORY_KEY, [next, ...history].slice(0, 50));
  return next;
}

export function isLikelyMutatingSql(sql: string) {
  const normalized = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  if (
    /^pragma\s+(?:["'`[\]\w.]+\.)?(?:table_info|table_xinfo|foreign_key_list|index_list|index_info|index_xinfo)\s*\(/.test(
      normalized,
    )
  ) {
    return false;
  }

  return /\b(create|drop|alter|insert|update|delete|replace|vacuum|reindex|attach|detach|pragma)\b/.test(normalized);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mimeType = "application/octet-stream") {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
