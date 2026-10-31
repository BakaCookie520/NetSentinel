import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service.js";
import { BackupRuntime } from "./backup-runtime.js";
import { BackupService } from "./backup-service.js";
import { QueueService } from "./services.js";
import { hashPassword } from "./auth.js";
import { decryptSecret, encryptSecret, type SecretEnvelope } from "@netsentinel/core";
import { backupDirectory, backupPath, atomicJson } from "./backup-storage.js";
import { BACKUP_LOCK, RESTORE_GATE, type BackupJob } from "./backup-types.js";
import { CHECKPOINT_KEY } from "./backup-database.js";

// Destructive by design: refuse to run against a normal application database
// or the default shared Redis. CI creates these isolated resources explicitly.
const isolated = Boolean(process.env.NETSENTINEL_BACKUP_INTEGRATION === "true" && /backup_test/u.test(process.env.DATABASE_URL ?? "") && process.env.REDIS_PORT && process.env.REDIS_PORT !== "6379");
describe.runIf(isolated)("isolated complete-site backup and restore", () => {
  let prisma: PrismaService; let runtime: BackupRuntime; let queues: QueueService; let service: BackupService; let directory: string;
  const sourceKey = Buffer.alloc(32, 3);
  const targetKey = Buffer.alloc(32, 4);
  const password = "integration-backup-passphrase";
  const accountPassword = "IntegrationPass123!";
  const avatar = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let userId: string; let avatarKey: string; let backupId: string;
  async function wait(job: BackupJob) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const next = await service.job(job.id);
      if (next.status !== "running") {
        // Job status is persisted before distributed-lock cleanup.
        while (await runtime.redis.exists(BACKUP_LOCK)) await new Promise((r) => setTimeout(r, 20));
        return next;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Integration backup job timed out");
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "netsentinel-backup-integration-"));
    process.env.NETSENTINEL_DATA_DIR = directory;
    process.env.NETSENTINEL_MASTER_KEY = sourceKey.toString("base64");
    prisma = new PrismaService(); await prisma.$connect();
    runtime = new BackupRuntime(); queues = new QueueService();
    service = new BackupService(prisma, queues, runtime); await service.onModuleInit();
    const role = await prisma.role.create({ data: { name: "system-admin", system: true, permissions: ["backup:manage", "user:manage"] } });
    avatarKey = `${randomUUID()}.png`;
    const user = await prisma.user.create({ data: { email: "backup@example.com", displayName: "Backup administrator", avatarKey,
      passwordHash: await hashPassword(accountPassword), roles: { create: { roleId: role.id } } } });
    userId = user.id;
    await mkdir(join(directory, "avatars")); await writeFile(join(directory, "avatars", avatarKey), avatar);
    const credential = await prisma.credential.create({ data: { id: "credential", name: "Secret", type: "HTTP_BEARER", encrypted: encryptSecret("sensitive-token", sourceKey, "credential") as never } });
    const monitor = await prisma.monitor.create({ data: { id: "monitor", name: "Test monitor", type: "HTTP", target: "https://example.com", config: {}, credentialId: credential.id, tags: { create: { tag: { create: { name: "production" } } } } } });
    const workflow = await prisma.workflow.create({ data: { id: "workflow", name: "Recovery", monitorId: monitor.id, trigger: "DOWN", steps: { create: { id: "step", position: 0, name: "Notify", type: "HTTP", config: { url: "https://example.com" }, credentialId: credential.id } } } });
    const incident = await prisma.incident.create({ data: { id: "incident", monitorId: monitor.id, title: "Unavailable", assigneeId: userId,
      comments: { create: { authorId: userId, body: "Investigating" } } } });
    await prisma.probeResult.createMany({ data: Array.from({ length: 1105 }, (_, n) => ({ monitorId: monitor.id, ok: n % 3 !== 0, latencyMs: n })) });
    await prisma.statusDailyMetric.create({ data: { monitorId: monitor.id, day: new Date("2026-10-31"), successCount: 20, failureCount: 2 } });
    await prisma.workflowRun.create({ data: { id: "run", workflowId: workflow.id, incidentId: incident.id, trigger: "DOWN", idempotencyKey: "backup-run", status: "RUNNING",
      steps: { create: { workflowStepId: "step", status: "RUNNING" } } } });
    await prisma.approval.create({ data: { workflowId: workflow.id, incidentId: incident.id, expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.agent.create({ data: { name: "Production agent", status: "ONLINE", tokenHash: "agent-hash" } });
    await prisma.maintenanceWindow.create({ data: { name: "Patch", monitorId: monitor.id, startsAt: new Date(), endsAt: new Date(Date.now() + 1000) } });
    await prisma.apiToken.create({ data: { name: "Automation", tokenHash: "api-hash", scopes: ["monitor:read"], userId } });
    await prisma.setting.create({ data: { key: "timezone", value: "Asia/Shanghai" } });
    await service.savePolicy({ enabled: false, frequency: "daily", time: "03:00", weekday: 0, timezone: "Asia/Shanghai", retain: 2, password }, userId);
  }, 60_000);
  afterAll(async () => {
    await service?.onModuleDestroy(); await queues?.onModuleDestroy(); await runtime?.onModuleDestroy(); await prisma?.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("creates a consistent paginated encrypted backup and hides secrets", async () => {
    const job = await wait(await service.create("Full site", "integration", userId));
    expect(job.status, job.error).toBe("succeeded"); backupId = job.backupId!;
    const entry = await service.detail(backupId);
    expect(entry.counts?.ProbeResult).toBe(1105); expect(entry.counts?.UserRole).toBe(1);
    expect(JSON.stringify(await service.list())).not.toContain("archivePassword");
    expect(JSON.stringify(await service.policyView())).not.toContain("ciphertext");
    expect((await readFile(backupPath(backupId))).includes(Buffer.from("sensitive-token"))).toBe(false);
  }, 60_000);
  it("restores complete data with a new master key, expires sessions and does not replay tasks", async () => {
    await prisma.monitor.update({ where: { id: "monitor" }, data: { name: "Changed" } });
    await prisma.session.create({ data: { idHash: "session", csrfHash: "csrf", expiresAt: new Date(Date.now() + 60_000), userId } });
    await queues.probe.add("old", { monitorId: "monitor" }); await queues.workflow.add("old", { runId: "run" });
    await rm(join(directory, "avatars", avatarKey));
    const importedPath = join(directory, "transfer.nsbackup"); await writeFile(importedPath, await readFile(backupPath(backupId)));
    process.env.NETSENTINEL_MASTER_KEY = targetKey.toString("base64");
    // Simulate a new target instance's local backup policy, not copied source policy.
    await service.savePolicy({ enabled: false, frequency: "daily", time: "04:00", weekday: 0, timezone: "UTC", retain: 3, password }, userId);
    const imported = await wait(await service.import(importedPath, password, "Portable copy", userId)); expect(imported.status, imported.error).toBe("succeeded");
    // Current site must be self-consistent for the mandatory protection backup.
    await writeFile(join(directory, "avatars", avatarKey), avatar);
    await prisma.credential.update({ where: { id: "credential" }, data: { encrypted: encryptSecret("current-token", targetKey, "credential") as never } });
    const restored = await wait(await service.restore(imported.backupId!, userId)); expect(restored.status, restored.error).toBe("succeeded");
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: "monitor" } })).name).toBe("Test monitor");
    expect(await prisma.probeResult.count()).toBe(1105); expect(await prisma.session.count()).toBe(0);
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: "run" } })).status).toBe("UNKNOWN");
    expect((await prisma.stepRun.findFirstOrThrow()).status).toBe("UNKNOWN");
    expect((await prisma.approval.findFirstOrThrow()).status).toBe("CANCELLED");
    expect((await prisma.agent.findFirstOrThrow()).status).toBe("OFFLINE");
    const credential = await prisma.credential.findUniqueOrThrow({ where: { id: "credential" } });
    expect(decryptSecret(credential.encrypted as unknown as SecretEnvelope, targetKey, credential.id)).toBe("sensitive-token");
    expect(await readFile(join(directory, "avatars", avatarKey))).toEqual(avatar);
    expect(await runtime.redis.exists(RESTORE_GATE)).toBe(0);
    expect(await queues.probe.getWaitingCount()).toBe(0); expect(await queues.workflow.getWaitingCount()).toBe(0);
    expect((await service.policyView()).time).toBe("04:00");
    expect((await service.list()).some((e) => e.source === "protection")).toBe(true);
  }, 60_000);
  it("preserves data if the mandatory protection snapshot cannot complete", async () => {
    await prisma.monitor.update({ where: { id: "monitor" }, data: { name: "Must survive" } });
    await rm(join(directory, "avatars", avatarKey));
    const imported = (await service.list()).find((e) => e.source === "import")!;
    const job = await wait(await service.restore(imported.id, userId));
    expect(job.status).toBe("failed");
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: "monitor" } })).name).toBe("Must survive");
    expect(await runtime.redis.exists(RESTORE_GATE)).toBe(0);
    await writeFile(join(directory, "avatars", avatarKey), avatar);
  }, 60_000);
  it("rolls back database changes and retains avatars when a restore transaction fails", async () => {
    const { restoreDatabase, schemaFingerprint } = await import("./backup-database.js");
    const stage = join(directory, "bad-transaction"); await mkdir(stage);
    await writeFile(join(stage, "Role.ndjson"), JSON.stringify({ id: "x", name: null, permissions: [], system: false, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) + "\n");
    await expect(restoreDatabase(prisma, stage, { manifest: { kind: "manifest", formatVersion: 1, schemaFingerprint, createdAt: new Date().toISOString(), applicationVersion: "test", sourceMasterKey: targetKey.toString("base64") }, counts: {}, bytes: 0, avatars: 0 }, randomUUID())).rejects.toThrow();
    expect(await prisma.user.count()).toBe(1); expect(await prisma.monitor.count()).toBe(1);
    expect(await readFile(join(directory, "avatars", avatarKey))).toEqual(avatar);
  }, 60_000);
  it("recovers a committed database checkpoint after a simulated crash before avatar switch", async () => {
    const id = randomUUID(); const stage = join(backupDirectory(), `restore-${id}`); await mkdir(join(stage, "avatars"), { recursive: true });
    await writeFile(join(stage, "avatars", avatarKey), avatar);
    await prisma.setting.upsert({ where: { key: CHECKPOINT_KEY }, create: { key: CHECKPOINT_KEY, value: id }, update: { value: id } });
    await atomicJson(join(backupDirectory(), "restore.json"), { id, backupId, protectionId: backupId, actorId: userId, stage, oldAvatars: join(directory, `avatars-before-${id}`), phase: "prepared" });
    await atomicJson(backupPath(id, "job"), { id, type: "restore", status: "running", phase: "restoring", createdAt: new Date().toISOString() });
    await service.onModuleDestroy();
    service = new BackupService(prisma, queues, runtime); await service.onModuleInit();
    expect(await readFile(join(directory, "avatars", avatarKey))).toEqual(avatar);
    expect((await service.job(id)).status).toBe("succeeded");
    expect(await runtime.redis.exists(RESTORE_GATE)).toBe(0);
    expect((await readdir(directory)).some((name) => name.startsWith("avatars-before-"))).toBe(false);
  }, 60_000);
  it("deduplicates scheduled runs and prunes only successful scheduled copies", async () => {
    await service.savePolicy({ enabled: true, frequency: "daily", time: "00:00", weekday: 0, timezone: "UTC", retain: 1 }, userId);
    const engine = service as unknown as { tick(): Promise<void> };
    await engine.tick();
    while (await runtime.redis.exists(BACKUP_LOCK)) await new Promise((r) => setTimeout(r, 30));
    const first = (await service.list()).filter((e) => e.source === "scheduled");
    expect(first).toHaveLength(1);
    await engine.tick();
    expect((await service.list()).filter((e) => e.source === "scheduled")).toHaveLength(1);
    const created = await wait(await service.create("Second scheduled", "", null, "scheduled"));
    expect(created.status, created.error).toBe("succeeded");
    const entries = await service.list();
    expect(entries.filter((e) => e.source === "scheduled" && e.status === "ready")).toHaveLength(1);
    expect(entries.some((e) => e.source === "manual" && e.id === backupId)).toBe(true);
    expect(entries.some((e) => e.source === "protection")).toBe(true);
  }, 60_000);
  it("fences concurrent writers and aborts on drain timeout without replacing data", async () => {
    const release = await runtime.enterWrite();
    process.env.NETSENTINEL_RESTORE_DRAIN_TIMEOUT_MS = "1000";
    try {
      const imported = (await service.list()).find((e) => e.source === "import")!;
      const job = await wait(await service.restore(imported.id, userId));
      expect(job.status).toBe("failed");
      expect((await prisma.monitor.findUniqueOrThrow({ where: { id: "monitor" } })).name).toBe("Must survive");
      expect(await runtime.redis.exists(RESTORE_GATE)).toBe(0);
    } finally { delete process.env.NETSENTINEL_RESTORE_DRAIN_TIMEOUT_MS; await release(); }
    await runtime.redis.set(RESTORE_GATE, "test-gate");
    try { await expect(runtime.enterWrite()).rejects.toThrow("RESTORE_IN_PROGRESS"); }
    finally { await runtime.redis.del(RESTORE_GATE); }
  }, 60_000);
});
