import { Worker } from "node:worker_threads";
import { mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { type Adapter, type EntityName, type Query, type Mutation, type RecordData } from "./model.js";

export class SqliteAdapter implements Adapter {
  readonly kind = "sqlite" as const;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private constructor(private worker: Worker) {
    worker.on("message", (message: { id: number; result?: unknown; error?: string }) => {
      const callback = this.pending.get(message.id); this.pending.delete(message.id);
      if (message.error) callback?.reject(new Error(message.error)); else callback?.resolve(message.result);
    });
    worker.on("error", (error) => { for (const callback of this.pending.values()) callback.reject(error instanceof Error ? error : new Error("STORAGE_WORKER_FAILED")); this.pending.clear(); });
    worker.on("exit", () => { for (const callback of this.pending.values()) callback.reject(new Error("STORAGE_CLOSED")); this.pending.clear(); });
  }
  static async open(path: string, options: { archiveStaging?: boolean } = {}): Promise<SqliteAdapter> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const adapter = new SqliteAdapter(new Worker(new URL("./sqlite-worker.js", import.meta.url), { workerData: { path, ...options } }));
    await adapter.revision();
    await chmod(path, 0o600);
    return adapter;
  }
  private request<T>(op: string, body: RecordData = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({ id, op, ...body });
    });
  }
  revision() { return this.request<number>("revision"); }
  get(entity: EntityName, key: string) { return this.request<RecordData | null>("get", { entity, key }); }
  list(entity: EntityName, query: Query = {}) { return this.request<RecordData[]>("list", { entity, query }); }
  async commit(expected: number, mutations: Mutation[]) { await this.request("commit", { expected, mutations }); }
  async close() { await this.request("close"); await this.worker.terminate(); }
}
