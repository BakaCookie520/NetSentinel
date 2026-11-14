import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store as StoreType } from "./storage/store.js";

const moduleUrl = (name: string) => new URL(`../dist/storage/${name}.js`, import.meta.url).href;
const directories: string[] = [];
const stores: StoreType[] = [];
const backends = ["sqlite", ...(process.env.ONBOARDING_POSTGRES_URL ? ["postgresql"] : []), ...(process.env.ONBOARDING_REDIS_URL ? ["redis"] : [])];
afterEach(async () => { for (const store of stores.splice(0)) await store.adapter.close(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function open(kind: string) {
  const { Store } = await import(moduleUrl("store"));
  let adapter;
  if (kind === "sqlite") {
    const directory = await mkdtemp(join(tmpdir(), "ns-storage-contract-")); directories.push(directory);
    adapter = await (await import(moduleUrl("sqlite"))).SqliteAdapter.open(join(directory, "database.sqlite"));
  } else if (kind === "postgresql") adapter = new (await import(moduleUrl("postgres"))).PostgresAdapter(process.env.ONBOARDING_POSTGRES_URL);
  else adapter = await (await import(moduleUrl("redis"))).RedisAdapter.open(process.env.ONBOARDING_REDIS_URL, `contract_${randomUUID().replaceAll("-", "")}`);
  const store = new Store(adapter) as StoreType; stores.push(store); return store;
}
for (const kind of backends) describe(`${kind} storage contract`, () => {
  if (kind === "redis") it("blocks reads during a partial commit and rolls back its durable journal on restart", async () => {
    const store = await open(kind);
    const tag = await store.transaction((tx) => tx.put("Tag", { name: `before-${randomUUID()}` }));
    const adapter = store.adapter as unknown as {
      prefix: string; client: { set(key: string, value: string): Promise<unknown> };
    };
    const key = JSON.stringify([tag.id]);
    await adapter.client.set(`${adapter.prefix}journal`, JSON.stringify({ expected: await store.adapter.revision(), before: [{ entity: "Tag", key, row: tag }] }));
    await adapter.client.set(`${adapter.prefix}row:Tag:${key}`, JSON.stringify({ ...tag, name: "partial-uncommitted-value" }));
    await expect(store.get("Tag", tag.id)).rejects.toThrow("STORAGE_RECOVERY_REQUIRED");
    await store.adapter.close(); stores.splice(stores.indexOf(store), 1);
    const recovered = await (await import(moduleUrl("redis"))).RedisAdapter.open(process.env.ONBOARDING_REDIS_URL, adapter.prefix.slice(0, -1));
    const { Store } = await import(moduleUrl("store")); const replacement = new Store(recovered) as StoreType; stores.push(replacement);
    expect((await replacement.get("Tag", tag.id))?.name).toBe(tag.name);
    expect(await replacement.list("Tag", { filters: [{ field: "name", op: "eq", value: tag.name }] })).toHaveLength(1);
  });
  it("commits relations atomically, enforces unique fields, supports CAS and sorted queries", async () => {
    const store = await open(kind); const unique = randomUUID();
    const user = await store.transaction(async (tx) => {
      const role = await tx.put("Role", { name: `role-${unique}`, permissions: ["monitor:read"] });
      const user = await tx.put("User", { email: `${unique}@test.local`, displayName: "First", passwordHash: "hash" });
      await tx.put("UserRole", { userId: user.id, roleId: role.id });
      return user;
    });
    expect((await store.get("User", user.id))?.displayName).toBe("First");
    const updated = await store.transaction((tx) => tx.put("User", { ...user, displayName: "Changed" }, user.version));
    expect(updated.version).toBe(2);
    await expect(store.transaction((tx) => tx.put("User", { ...user, displayName: "Stale" }, user.version))).rejects.toThrow("STORAGE_CONFLICT");
    await expect(store.transaction((tx) => tx.put("User", { email: user.email, displayName: "Duplicate", passwordHash: "hash" }))).rejects.toThrow("STORAGE_DUPLICATE");
    const missing = randomUUID();
    await expect(store.transaction((tx) => tx.put("UserRole", { userId: missing, roleId: missing }))).rejects.toThrow("STORAGE_RELATION_INVALID");
    expect(await store.get("UserRole", { userId: missing, roleId: missing })).toBeNull();
    await expect(store.transaction(async (tx) => { await tx.put("Tag", { name: `rollback-${unique}` }); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect(await store.list("Tag", { filters: [{ field: "name", op: "eq", value: `rollback-${unique}` }] })).toEqual([]);
    await store.transaction((tx) => tx.remove("User", user.id));
    expect((await store.list("UserRole", { filters: [{ field: "userId", op: "eq", value: user.id }] })).length).toBe(0);
  }, 30000);
  it("pages more than 500 records without omissions and preserves JSON/null/date types", async () => {
    const store = await open(kind); const prefix = randomUUID();
    const monitor = await store.transaction((tx) => tx.put("Monitor", { name: prefix, type: "HTTP", target: "https://example.com", config: { expected: null, headers: { test: "value" } } }));
    await store.transaction(async (tx) => {
      for (let index = 0; index < 510; index += 1) await tx.put("ProbeResult", { monitorId: monitor.id, ok: index % 2 === 0, latencyMs: index, checkedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() });
    });
    const rows = await store.all("ProbeResult", [{ field: "monitorId", op: "eq", value: monitor.id }]);
    expect(rows).toHaveLength(510); expect(new Set(rows.map((row) => row.id)).size).toBe(510);
    expect((await store.get("Monitor", monitor.id))?.config).toEqual({ expected: null, headers: { test: "value" } });
    const sorted = await store.list("ProbeResult", { filters: [{ field: "monitorId", op: "eq", value: monitor.id }, { field: "latencyMs", op: "gte", value: 505 }], order: [{ field: "latencyMs", direction: "desc" }], limit: 3 });
    expect(sorted.map((row) => row.latencyMs)).toEqual([509, 508, 507]);
    const recent = await store.list("ProbeResult", { filters: [{ field: "monitorId", op: "eq", value: monitor.id }, { field: "checkedAt", op: "gte", value: new Date(Date.UTC(2026, 0, 1, 0, 505)).toISOString() }], order: [{ field: "latencyMs", direction: "desc" }], limit: 10 });
    expect(recent.map((row) => row.latencyMs)).toEqual([509, 508, 507, 506, 505]);
    await store.transaction((tx) => tx.remove("Monitor", monitor.id));
    expect(await store.list("ProbeResult", { filters: [{ field: "monitorId", op: "eq", value: monitor.id }] })).toEqual([]);
  }, 120000);
});
