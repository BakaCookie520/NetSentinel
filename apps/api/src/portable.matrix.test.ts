import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import express from "express";
import { encryptSecret, decryptSecret, type SecretEnvelope } from "@netsentinel/core";
import type { ApplicationState } from "./combined/setup.js";
import type { PortableBackups } from "./combined/portable-backup.js";
import { readMail, encodeMail, MAIL_SETTING } from "./combined/mail-config.js";
import { passwordHash } from "./combined/security.js";
import { backupPath, atomicJson, backupDirectory } from "./backup-storage.js";
import type { BackupJob } from "./backup-types.js";

const compiled = (name: string) => new URL(`../dist/${name}.js`, import.meta.url).href;
const kinds = ["sqlite", ...(process.env.ONBOARDING_POSTGRES_URL ? ["postgresql"] : []), ...(process.env.ONBOARDING_REDIS_URL ? ["redis"] : [])];
const closers: Array<() => Promise<void>> = []; const directories: string[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); for (const dir of directories.splice(0)) await rm(dir, { force: true, recursive: true }); vi.unstubAllEnvs(); });
async function create(kind: string, byte: number) {
  const directory = await mkdtemp(join(tmpdir(), "ns-portable-matrix-")); directories.push(directory);
  vi.stubEnv("NETSENTINEL_DATA_DIR", directory);
  const { InstallationConfig, openDatabase } = await import(compiled("combined/config"));
  const config = new InstallationConfig(); config.key = Buffer.alloc(32, byte);
  let database: Record<string, unknown> = { type: "sqlite" };
  if (kind === "postgresql") {
    if (!process.env.ONBOARDING_POSTGRES_URL?.includes("test")) throw new Error("Tests require a dedicated test database");
    const url = new URL(process.env.ONBOARDING_POSTGRES_URL); url.searchParams.set("schema", `onboarding_${randomUUID().replaceAll("-", "")}`);
    database = { type: kind, url: url.toString() };
  }
  if (kind === "redis") database = { type: kind, url: process.env.ONBOARDING_REDIS_URL, namespace: `matrix_${randomUUID().replaceAll("-", "")}` };
  config.state = { initialized: true, database };
  const store = await openDatabase(database, kind === "postgresql");
  const { CombinedRuntime } = await import(compiled("combined/runtime"));
  const runtime = new CombinedRuntime(store, config.key); await runtime.start();
  const state = { config, store, runtime, activate: async () => undefined } as ApplicationState;
  const app = express(); app.locals.drainWrites = async () => undefined;
  const { PortableBackups: Service } = await import(compiled("combined/portable-backup"));
  const backups = new Service(app, state) as PortableBackups; await backups.initialize();
  closers.push(async () => { vi.stubEnv("NETSENTINEL_DATA_DIR", directory); await backups.close(); await runtime.close(); await store.adapter.close(); });
  const user = await store.transaction(async (tx: import("./storage/store.js").UnitOfWork) => {
    const role = await tx.put("Role", { name: "system-admin", permissions: ["user:manage", "backup:manage"], system: true });
    const user = await tx.put("User", { email: "admin@matrix.local", displayName: `source-${kind}`, passwordHash: await passwordHash("Matrix-password-123!") });
    await tx.put("UserRole", { userId: user.id, roleId: role.id });
    return user;
  });
  await backups.savePolicy({ enabled: false, frequency: "daily", time: "03:00", weekday: 0, timezone: "UTC", retain: 2, password: "Portable-passphrase-123!" }, user.id);
  return { state, backups, directory, user };
}
async function wait(backups: PortableBackups, job: BackupJob) {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const next = await backups.job(job.id);
    if (next.status !== "running") { expect(next.status, next.error).toBe("succeeded"); return next; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Backup job timed out");
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}
for (const source of kinds) for (const target of kinds) describe(`portable ${source} -> ${target}`, () => {
  it("restores full business data and re-encrypts credentials/TOTP without replaying actions", async () => {
    const origin = await create(source, 5);
    const userId = origin.user.id; const key = `${randomUUID()}.png`;
    await mkdir(join(origin.directory, "avatars"), { recursive: true });
    await writeFile(join(origin.directory, "avatars", key), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await origin.state.store!.transaction(async (tx) => {
      await tx.put("User", { ...origin.user, avatarKey: key });
      await tx.put("AccountSecurity", { userId, recoveryHash: "recovery-hash", totpEncrypted: { ...encryptSecret("TOTPSECRET", origin.state.config.key, userId) }, backupHashes: ["unused-code-hash"], totpLastCounter: 123 });
      await tx.put("Credential", { id: "matrix-credential", name: "secret", type: "HTTP_BEARER", encrypted: { ...encryptSecret("sensitive-token", origin.state.config.key, "matrix-credential") } });
      const monitor = await tx.put("Monitor", { name: "persisted monitor", type: "HTTP", target: "https://example.com", config: {}, enabled: false, credentialId: "matrix-credential" });
      await tx.put("ProbeResult", { monitorId: monitor.id, ok: true, latencyMs: 25 });
      const workflow = await tx.put("Workflow", { name: "must-not-replay", trigger: "MANUAL", monitorId: monitor.id });
      await tx.put("WorkflowRun", { workflowId: workflow.id, trigger: "MANUAL", status: "PENDING", idempotencyKey: "matrix-run" });
      await tx.put("Session", { idHash: "old-session", csrfHash: "csrf", userId, expiresAt: new Date(Date.now() + 60000).toISOString() });
    });
    const snapshot = await wait(origin.backups, await origin.backups.create("Portable", "", userId));
    const archive = await readFile(backupPath(snapshot.backupId!));
    expect(archive.includes(Buffer.from("sensitive-token"))).toBe(false);
    const destination = await create(target, 6);
    const upload = join(destination.directory, "upload.nsbackup"); await writeFile(upload, archive);
    const imported = await wait(destination.backups, await destination.backups.import(upload, "Portable-passphrase-123!", "Imported", destination.user.id));
    await wait(destination.backups, await destination.backups.restore(imported.backupId!, destination.user.id));
    const store = destination.state.store!;
    expect((await store.get("User", userId))?.email).toBe("admin@matrix.local");
    expect(await store.get("User", destination.user.id)).toBeNull();
    expect((await store.all("ProbeResult"))).toHaveLength(1);
    expect((await store.all("Session"))).toHaveLength(0);
    expect((await store.all("WorkflowRun"))[0]?.status).toBe("CANCELLED");
    expect((await store.all("DurableJob"))).toHaveLength(0);
    const credential = await store.get("Credential", "matrix-credential");
    expect(decryptSecret(credential!.encrypted as unknown as SecretEnvelope, destination.state.config.key, credential!.id)).toBe("sensitive-token");
    const security = await store.get("AccountSecurity", userId);
    expect(decryptSecret(security!.totpEncrypted as unknown as SecretEnvelope, destination.state.config.key, userId)).toBe("TOTPSECRET");
    expect(security?.backupHashes).toEqual(["unused-code-hash"]); expect(security?.totpLastCounter).toBe(123);
    expect(await readFile(join(destination.directory, "avatars", key))).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(destination.state.runtime?.restoring).toBe(false);
    expect((await destination.backups.list()).some((entry) => entry.source === "protection")).toBe(true);
  }, 120000);
  it("restores only selected settings and rewraps SMTP without touching accounts or operational data", async () => {
    const origin = await create(source, 3); const sourceDb = origin.state.store!;
    const smtp = { enabled: true, host: "smtp.example.test", port: 587, tls: "starttls" as const, user: "sender", password: "source-password", from: "notify@example.test" };
    await sourceDb.transaction(async (tx) => {
      await tx.put("Setting", { key: "backup-setting", value: "from-source" });
      await tx.put("Setting", { key: MAIL_SETTING, value: encodeMail(smtp, origin.state.config.key) });
      await tx.put("Setting", { key: "__notPortable", value: "secret runtime state" });
      await tx.put("Tag", { name: "excluded-source-tag" });
    });
    const snapshot = await wait(origin.backups, await origin.backups.create("Settings only", "", origin.user.id, "manual", ["settings"]));
    const id = snapshot.backupId!;
    const entry = await origin.backups.entry(id);
    expect(entry.groups).toEqual(["settings"]); expect(entry.formatVersion).toBe(3);
    expect(Object.keys(entry.counts!)).toEqual(["Setting"]);
    const { readArchive } = await import(compiled("backup-format"));
    const contents: Array<Record<string, unknown>> = [];
    for await (const record of readArchive(origin.backups.path(id), "Portable-passphrase-123!")) contents.push(record);
    expect(contents[0]?.sourceMasterKey).not.toBe(origin.state.config.key.toString("base64"));
    expect(JSON.stringify(contents)).not.toContain("__notPortable");
    expect(JSON.stringify(contents)).not.toContain(smtp.password);
    const archive = await readFile(origin.backups.path(id));
    const destination = await create(target, 4); const targetDb = destination.state.store!;
    const originalToken = await targetDb.transaction(async (tx) => {
      await tx.put("Tag", { name: "live-tag" });
      await tx.put("Setting", { key: "backup-setting", value: "replace-me" });
      await tx.put("Setting", { key: "__notPortable", value: "keep" });
      return tx.put("Session", { idHash: "live-session", csrfHash: "csrf", userId: destination.user.id, expiresAt: new Date(Date.now() + 60000).toISOString() });
    });
    const upload = join(destination.directory, "settings.nsbackup"); await writeFile(upload, archive);
    const imported = await wait(destination.backups, await destination.backups.import(upload, "Portable-passphrase-123!", "Settings", destination.user.id));
    await expect(destination.backups.restore(imported.backupId!, destination.user.id, ["accounts"])).rejects.toThrow("BACKUP_GROUP_UNAVAILABLE");
    const result = await wait(destination.backups, await destination.backups.restore(imported.backupId!, destination.user.id, ["settings"]));
    expect(result.sessionReset).toBe(false);
    expect(await targetDb.get("Session", originalToken.idHash)).toEqual(originalToken);
    expect(await targetDb.get("User", destination.user.id)).toEqual(destination.user);
    expect((await targetDb.all("Tag")).map(({ name }) => name)).toEqual(["live-tag"]);
    expect((await targetDb.get("Setting", "backup-setting"))?.value).toBe("from-source");
    expect((await targetDb.get("Setting", "__notPortable"))?.value).toBe("keep");
    expect(await readMail(targetDb, destination.state.config.key)).toEqual(smtp);
    await expect(readMail(targetDb, origin.state.config.key)).rejects.toThrow();
    expect((await destination.backups.list()).find((entry) => entry.source === "protection")?.groups).toEqual(["accounts", "settings", "operations", "audit"]);
  }, 120000);

});
describe("portable restore protection", () => {
  it("keeps import running until its durable completion releases the backup lock", async () => {
    const { backups } = await create("sqlite", 4);
    const finishImport = deferred();
    const allowFinalization = deferred();
    let terminalRenamed = false;
    const imported = await backups.start("import", () => finishImport.promise);
    const filesystem = createRequire(import.meta.url)("node:fs/promises") as typeof import("node:fs/promises");
    const rename = filesystem.rename;
    const spy = vi.spyOn(filesystem, "rename").mockImplementation(async (source, target) => {
      await rename(source, target);
      if (target === backups.path(imported.id, "job")) {
        terminalRenamed = true;
        await allowFinalization.promise;
      }
    });
    syncBuiltinESMExports();
    try {
      finishImport.resolve();
      await vi.waitFor(() => expect(terminalRenamed).toBe(true));
      expect((await backups.job(imported.id)).status).toBe("running");
      await expect(backups.start("restore", async () => undefined)).rejects.toThrow("BACKUP_BUSY");
    } finally {
      allowFinalization.resolve();
      spy.mockRestore();
      syncBuiltinESMExports();
    }
    await wait(backups, imported);
    await wait(backups, await backups.start("restore", async () => undefined));
  });
  for (const version of [1, 2]) it(`imports old v${version} rows and preserves target SMTP when restoring legacy settings`, async () => {
    const origin = await create("sqlite", 7);
    const { TABLES } = await import("./backup-database.js");
    const { writeArchive } = await import(compiled("backup-format"));
    const smtp = { enabled: true, host: "smtp.example.test", port: 465, tls: "implicit" as const, user: "", password: "", from: "admin@example.test" };
    await origin.state.store!.transaction(async (tx) => {
      await tx.put("Setting", { key: MAIL_SETTING, value: encodeMail(smtp, origin.state.config.key) });
      await tx.put("Setting", { key: "legacy-setting", value: "imported" });
    });
    const tables = version === 1 ? TABLES : [...TABLES, "AccountSecurity"] as const;
    async function* records() {
      yield { kind: "manifest", formatVersion: version, schemaFingerprint: version === 1 ? "ebbcbb311672dfe1dc5323a978908efe520407c995f1d57080f23f150066ca3e" : "netsentinel-logical-2", createdAt: new Date().toISOString(), applicationVersion: "0.1.0", sourceMasterKey: origin.state.config.key.toString("base64") };
      const counts: Record<string, number> = {};
      for (const table of tables) {
        counts[table] = 0;
        for await (const input of origin.state.store!.iterate(table)) {
          const row = { ...input } as Record<string, unknown>;
          if (table === "Setting" && typeof row.key === "string" && row.key.startsWith("__")) continue;
          if (table === "User") { delete row.username; delete row.emailVerified; }
          counts[table]! += 1; yield { kind: "row", table, data: row };
        }
      }
      yield { kind: "end", counts, avatars: 0 };
    }
    const path = join(origin.directory, "legacy.nsbackup");
    await writeArchive(path, "Legacy-passphrase-123!", records());
    const imported = await wait(origin.backups, await origin.backups.import(path, "Legacy-passphrase-123!", "Legacy", origin.user.id));
    const entry = await origin.backups.entry(imported.backupId!);
    expect(entry.formatVersion).toBe(version); expect(entry.groups).toEqual(["accounts", "settings", "operations", "audit"]);
    await origin.state.store!.transaction((tx) => tx.put("Setting", { key: "legacy-setting", value: "replaced" }));
    await wait(origin.backups, await origin.backups.restore(imported.backupId!, origin.user.id, ["settings"]));
    expect(await readMail(origin.state.store!, origin.state.config.key)).toEqual(smtp);
    expect((await origin.state.store!.get("Setting", "legacy-setting"))?.value).toBe("imported");
    await wait(origin.backups, await origin.backups.restore(imported.backupId!, origin.user.id, ["accounts"]));
    expect(await origin.state.store!.get("User", origin.user.id)).toMatchObject({ username: expect.stringMatching(/^legacy-/u), email: origin.user.email, emailVerified: false });
  }, 30000);
  it("rejects account replacement that would remove an unselected incident comment author", async () => {
    const origin = await create("sqlite", 2);
    const snapshot = await wait(origin.backups, await origin.backups.create("Accounts", "", origin.user.id, "manual", ["accounts"]));
    const destination = await create("sqlite", 8); const database = destination.state.store!;
    const comment = await database.transaction(async (tx) => {
      const monitor = await tx.put("Monitor", { name: "disabled", type: "HTTP", target: "https://example.com", config: {}, enabled: false });
      const incident = await tx.put("Incident", { monitorId: monitor.id, title: "test incident", status: "OPEN" });
      return tx.put("IncidentComment", { incidentId: incident.id, authorId: destination.user.id, body: "preserve" });
    });
    const path = join(destination.directory, "accounts.nsbackup");
    await writeFile(path, await readFile(origin.backups.path(snapshot.backupId!)));
    const imported = await wait(destination.backups, await destination.backups.import(path, "Portable-passphrase-123!", "Accounts", destination.user.id));
    const started = await destination.backups.restore(imported.backupId!, destination.user.id, ["accounts"]);
    await vi.waitFor(async () => expect(await destination.backups.job(started.id)).toMatchObject({ status: "failed", error: "BACKUP_DEPENDENCY_CONFLICT" }), { timeout: 10000 });
    expect(await database.get("IncidentComment", comment.id)).toEqual(comment);
    expect(await database.get("User", destination.user.id)).toEqual(destination.user);
    expect(await database.get("User", origin.user.id)).toBeNull();
  }, 30000);
  it("uses the configured group selection for scheduled backups", async () => {
    const origin = await create("sqlite", 3);
    await origin.backups.savePolicy({ enabled: true, frequency: "daily", time: "00:00", weekday: 0, timezone: "UTC", retain: 2, groups: ["audit"] }, origin.user.id);
    expect((await origin.backups.viewPolicy()).groups).toEqual(["audit"]);
    await (origin.backups as unknown as { tick(): Promise<void> }).tick();
    await vi.waitFor(async () => expect((await origin.backups.list()).find((entry) => entry.source === "scheduled")).toMatchObject({ groups: ["audit"], status: "ready", counts: { AuditEvent: expect.any(Number) } }), { timeout: 10000 });
  }, 30000);
  it("does not replace live data when the protection backup fails", async () => {
    const origin = await create("sqlite", 7); const key = `${randomUUID()}.png`;
    await mkdir(join(origin.directory, "avatars"), { recursive: true }); await writeFile(join(origin.directory, "avatars", key), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await origin.state.store!.transaction((tx) => tx.put("User", { ...origin.user, avatarKey: key }));
    const snapshot = await wait(origin.backups, await origin.backups.create("Before", "", origin.user.id));
    await origin.state.store!.transaction(async (tx) => { const current = (await tx.get("User", origin.user.id))!; await tx.put("User", { ...current, displayName: "Must survive" }); });
    await rm(join(origin.directory, "avatars", key));
    const job = await origin.backups.restore(snapshot.backupId!, origin.user.id);
    const until = Date.now() + 15000; let status;
    do { status = await origin.backups.job(job.id); if (status.status !== "running") break; await new Promise((resolve) => setTimeout(resolve, 20)); } while (Date.now() < until);
    expect(status?.status).toBe("failed");
    expect((await origin.state.store!.get("User", origin.user.id))?.displayName).toBe("Must survive");
    expect(origin.state.runtime?.restoring).toBe(false);
  }, 30000);
  it("finishes a committed avatar checkpoint before reopening after restart", async () => {
    const origin = await create("sqlite", 8); const identifier = randomUUID(); const backupId = randomUUID();
    const stage = join(backupDirectory(), `portable-restore-${identifier}`);
    await mkdir(join(stage, "avatars"), { recursive: true });
    const key = `${randomUUID()}.png`; const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await writeFile(join(stage, "avatars", key), bytes);
    await origin.state.store!.transaction((tx) => tx.put("Setting", { key: "__restoreCheckpoint", value: identifier }));
    await atomicJson(join(backupDirectory(), "portable-restore.json"), { id: identifier, backupId, stage, oldAvatars: join(origin.directory, `avatars-before-${identifier}`), phase: "prepared" });
    await atomicJson(backupPath(identifier, "job"), { id: identifier, type: "restore", status: "running", phase: "restoring", createdAt: new Date().toISOString() });
    await origin.backups.close();
    const { PortableBackups: Service } = await import(compiled("combined/portable-backup")); const app = express();
    const recovered = new Service(app, origin.state) as PortableBackups;
    await recovered.initialize(); await recovered.close();
    expect((await recovered.job(identifier)).status).toBe("succeeded");
    expect(await readFile(join(origin.directory, "avatars", key))).toEqual(bytes);
  }, 30000);
});
