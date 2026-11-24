import { mkdir, readFile, writeFile, rm, open } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { encryptSecret, decryptSecret, type SecretEnvelope } from "@netsentinel/core";
import { atomicJson, readJson, dataDirectory, syncDirectory } from "../backup-storage.js";
import { SqliteAdapter } from "../storage/sqlite.js";
import { PostgresAdapter } from "../storage/postgres.js";
import { RedisAdapter } from "../storage/redis.js";
import { Store } from "../storage/store.js";
import { z } from "zod";

export const databaseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sqlite") }),
  z.object({ type: z.literal("postgresql"), url: z.string().max(4096).refine((url) => /^postgres(?:ql)?:\/\//u.test(url)) }),
  z.object({ type: z.literal("redis"), url: z.string().max(4096).refine((url) => /^rediss?:\/\//u.test(url)), namespace: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u) }),
]);
export type DatabaseConfig = z.infer<typeof databaseSchema>;
export interface Installation {
  database?: DatabaseConfig;
  initialized: boolean;
  email?: string;
  username?: string;
  displayName?: string;
  passwordHash?: string;
  origin?: string;
}
export class InstallationConfig {
  key!: Buffer;
  token!: string;
  state: Installation = { initialized: false };
  private path = join(dataDirectory(), "installation.json");
  private lock = join(dataDirectory(), "application.lock");
  private held = false;
  private async processIdentity(pid: number): Promise<string> {
    if (process.platform !== "linux") return String(pid);
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const boot = await readFile("/proc/sys/kernel/random/boot_id", "utf8");
    return `${boot.trim()}:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`;
  }
  async acquire() {
    await mkdir(dataDirectory(), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(this.lock, JSON.stringify({ pid: process.pid, identity: await this.processIdentity(process.pid) }), { flag: "wx", mode: 0o600 });
        this.held = true; return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner = await readJson<{ pid: number; identity: string } | null>(this.lock, null);
        if (!owner) throw new Error("INSTANCE_LOCK_INVALID");
        try {
          process.kill(owner.pid, 0);
          if (owner.identity === await this.processIdentity(owner.pid)) throw new Error("INSTANCE_ALREADY_ACTIVE");
        }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
        await rm(this.lock);
      }
    }
    throw new Error("INSTANCE_ALREADY_ACTIVE");
  }
  async release() { if (this.held) { await rm(this.lock, { force: true }); this.held = false; } }
  async open() {
    await mkdir(dataDirectory(), { recursive: true, mode: 0o700 });
    const path = join(dataDirectory(), "master.key");
    const configured = process.env.NETSENTINEL_MASTER_KEY?.trim() || undefined;
    let saved: string | undefined;
    try { saved = (await readFile(path, "utf8")).trim(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (saved && configured && saved !== configured) throw new Error("MASTER_KEY_CONFLICT");
    const encoded = saved ?? configured ?? randomBytes(32).toString("base64");
    this.key = Buffer.from(encoded, "base64");
    if (this.key.length !== 32) throw new Error("MASTER_KEY_INVALID");
    if (!saved) {
      await writeFile(path, encoded, { mode: 0o600, flag: "wx" });
      const handle = await open(path, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(dataDirectory());
    }
    const encrypted = await readJson<SecretEnvelope | null>(this.path, null);
    if (encrypted) this.state = JSON.parse(decryptSecret(encrypted, this.key, "installation")) as Installation;
    const tokenPath = join(dataDirectory(), "setup.token");
    try { this.token = (await readFile(tokenPath, "utf8")).trim(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.token = randomBytes(32).toString("base64url");
      await writeFile(tokenPath, this.token, { mode: 0o600, flag: "wx" });
    }
    if (!this.state.initialized) console.log(`NetSentinel setup token: ${this.token}`);
  }
  verify(token: string): boolean {
    const actual = Buffer.from(token); const expected = Buffer.from(this.token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  async save(state: Installation) {
    await atomicJson(this.path, encryptSecret(JSON.stringify(state), this.key, "installation"));
    this.state = state;
  }
}
export async function openDatabase(config: DatabaseConfig, migrate = false): Promise<Store> {
  if (config.type === "sqlite") return new Store(await SqliteAdapter.open(join(dataDirectory(), "database", "netsentinel.sqlite")));
  if (config.type === "redis") return new Store(await RedisAdapter.open(config.url, config.namespace));
  if (migrate) {
    const check = new PostgresAdapter(config.url);
    try {
      const tables = await check.client.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`;
      const { entities } = await import("../storage/model.js");
      if (tables.some((table) => table.tablename !== "_prisma_migrations" && !entities.includes(table.tablename as typeof entities[number]))) throw new Error("SETUP_DATABASE_NOT_EMPTY");
    } finally { await check.close(); }
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const cli = join(root, "packages", "database", "node_modules", "prisma", "build", "index.js");
    await promisify(execFile)(process.execPath, [cli, "migrate", "deploy", "--schema", join(root, "packages/database/prisma/schema.prisma")], {
      env: { ...process.env, DATABASE_URL: config.url }, timeout: 120_000, maxBuffer: 1024 * 1024,
    });
  }
  const adapter = new PostgresAdapter(config.url);
  try { await adapter.revision(); return new Store(adapter); }
  catch (error) { await adapter.close(); throw error; }
}
