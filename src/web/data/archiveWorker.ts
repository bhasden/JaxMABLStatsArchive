import type { QueryResult } from "./archiveDb";

export type ArchiveWorkerStatus = "idle" | "loading" | "ready" | "error";

export type ArchiveWorkerState = {
  status: ArchiveWorkerStatus;
  error?: string;
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
};

type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export class ArchiveDbClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker = new Worker(new URL("./sqlWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) {
        return;
      }
      this.pending.delete(event.data.id);
      if (event.data.ok) {
        pending.resolve(event.data.result);
      } else {
        pending.reject(new Error(event.data.error));
      }
    };
  }

  load(bytes: Uint8Array) {
    const workerBytes = new Uint8Array(bytes);
    return this.call<void>("load", { bytes: workerBytes }, [workerBytes.buffer]);
  }

  exec(sql: string) {
    return this.call<QueryResult[]>("exec", { sql });
  }

  exportDb() {
    return this.call<Uint8Array>("export");
  }

  close() {
    this.worker.terminate();
    this.pending.clear();
  }

  private call<T>(type: string, payload: Record<string, unknown> = {}, transfer?: Transferable[]) {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload }, transfer ?? []);
    });
  }
}
