import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { encryptSecret, decryptSecret, type SecretEnvelope } from "@netsentinel/core";
import { PrismaService } from "./prisma.service.js";
import { QueueService } from "./services.js";
import { BackupRuntime } from "./backup-runtime.js";
import { atomicJson, backupDirectory, backupPath, dataDirectory, ensureBackupDirectory, readJson, requireDiskSpace, configuredLimit, syncAvatarStage } from "./backup-storage.js";
import { schemaFingerprint, snapshotRecords, validateArchive, restoreDatabase, CHECKPOINT_KEY } from "./backup-database.js";
import { writeArchive, uploadLimit } from "./backup-format.js";
import { BACKUP_LOCK, RESTORE_GATE, DEFAULT_POLICY, type BackupEntry, type BackupJob, type BackupPolicy, type BackupSource } from "./backup-types.js";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const master = () => Buffer.from(process.env.NETSENTINEL_MASTER_KEY!, "base64");
const safeError = (error: unknown) => error instanceof Error && /^BACKUP_[A-Z_]+$/u.test(error.message) ? error.message : "BACKUP_OPERATION_FAILED";
interface RestoreJournal { id: string; backupId: string; stage: string; phase: "prepared" | "database" | "avatars" | "complete"; oldAvatars: string; protectionId: string; actorId: string | null }
export function scheduleSlot(policy: BackupPolicy, date = new Date()): string | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: policy.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!);
  if (`${parts.hour}:${parts.minute}` < policy.time || (policy.frequency === "weekly" && weekday !== policy.weekday)) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private operations = new Set<Promise<void>>();
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(QueueService) private readonly queues: QueueService, @Inject(BackupRuntime) readonly runtime: BackupRuntime) {}
  private wrap(password: string, aad: string) { return encryptSecret(password, master(), aad); }
  private unwrap(value: unknown, aad: string) { return decryptSecret(value as SecretEnvelope, master(), aad); }
  private policyPath() { return join(backupDirectory(), "policy.json"); }
  private journalPath() { return join(backupDirectory(), "restore.json"); }
  private async policy(): Promise<BackupPolicy> { return readJson(this.policyPath(), { ...DEFAULT_POLICY }); }
  async policyView() {
    const { password, lastSlot: _lastSlot, ...policy } = await this.policy();
    return { ...policy, passwordConfigured: Boolean(password), uploadMaxBytes: uploadLimit() };
  }
  async onModuleInit(): Promise<void> {
    await ensureBackupDirectory();
    await this.withLock(async () => {
      const journal = await readJson<RestoreJournal | null>(this.journalPath(), null);
      if (journal && journal.phase !== "complete") {
        await this.runtime.redis.set(RESTORE_GATE, journal.id);
        await this.pauseQueues();
        const checkpoint = await this.prisma.setting.findUnique({ where: { key: CHECKPOINT_KEY } });
        if (checkpoint?.value === journal.id) { await this.drain(); await this.finishRestore(journal); }
        else {
          // Database transaction never committed: original avatars were not
          // touched. It is safe to abandon staging and reopen the old site.
          await rm(journal.stage, { recursive: true, force: true });
          await this.writeJournal({ ...journal, phase: "complete" });
          await this.releaseGate(journal.id);
        }
      } else {
        const gate = await this.runtime.redis.get(RESTORE_GATE);
        if (gate) await this.releaseGate(gate);
      }
      for (const name of await readdir(backupDirectory())) {
        if (/^[a-f0-9-]{36}\.job$/u.test(name)) {
          const path = join(backupDirectory(), name);
          const job = await readJson<BackupJob | null>(path, null);
          if (job?.status === "running") {
            const marker = job.type === "restore" ? await this.prisma.setting.findUnique({ where: { key: CHECKPOINT_KEY } }) : null;
            const restored = job.type === "restore" && marker?.value === job.id && (await readJson<RestoreJournal | null>(this.journalPath(), null))?.phase === "complete";
            await atomicJson(path, { ...job, status: restored ? "succeeded" : "failed", phase: restored ? "complete" : "interrupted", error: restored ? undefined : "BACKUP_INTERRUPTED", finishedAt: new Date().toISOString() });
          }
        }
        if (/^[a-f0-9-]{36}\.json$/u.test(name)) {
          const entry = await readJson<BackupEntry | null>(join(backupDirectory(), name), null);
          if (entry?.status === "running") await this.saveEntry({ ...entry, status: "failed", error: "BACKUP_INTERRUPTED" });
        }
        if (/^[a-f0-9-]{36}\.(partial|upload|tmp)$/u.test(name)) await rm(join(backupDirectory(), name), { force: true });
        if (/^[a-f0-9-]{36}\.(?:json|job)\.[a-f0-9-]{36}\.tmp$/u.test(name) || /^policy\.json\.[a-f0-9-]{36}\.tmp$/u.test(name) || /^restore\.json\.[a-f0-9-]{36}\.tmp$/u.test(name)) await rm(join(backupDirectory(), name), { force: true });
        if (/^(?:stage|restore)-[a-f0-9-]{36}$/u.test(name)) await rm(join(backupDirectory(), name), { recursive: true, force: true });
      }
    });
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, 30_000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> { if (this.timer) clearInterval(this.timer); await Promise.allSettled(this.operations); }
  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    if (!(await this.runtime.redis.set(BACKUP_LOCK, token, "PX", 90_000, "NX"))) throw new ConflictException("BACKUP_BUSY");
    let lost = false;
    const heartbeat = setInterval(() => {
      void this.runtime.redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],90000) else return 0 end", 1, BACKUP_LOCK, token).then((ok) => { if (!ok) lost = true; }).catch(() => { lost = true; });
    }, 15_000);
    try {
      // Redis supplies the runtime/avatar gate. A PostgreSQL advisory lock
      // additionally fences a stale process whose Redis lease expired during
      // an outage; a second app must not perform competing restore writes.
      const value = await this.prisma.$transaction(async (tx) => {
        const [result] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(1567843201) AS acquired`;
        if (!result?.acquired) throw new ConflictException("BACKUP_BUSY");
        return action();
      }, { timeout: 2 * 60 * 60_000 });
      if (lost) throw new Error("BACKUP_LOCK_LOST");
      return value;
    } finally {
      clearInterval(heartbeat);
      await this.runtime.redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, BACKUP_LOCK, token);
    }
  }
  private saveEntry(entry: BackupEntry) { return atomicJson(backupPath(entry.id, "json"), entry); }
  private publicEntry(entry: BackupEntry) { const { archivePassword: _password, ...view } = entry; return view; }
  private async entry(id: string): Promise<BackupEntry> {
    const entry = await readJson<BackupEntry | null>(backupPath(id, "json"), null);
    if (!entry) throw new NotFoundException("BACKUP_NOT_FOUND");
    return entry;
  }
  async list() {
    const entries: ReturnType<BackupService["publicEntry"]>[] = [];
    for (const name of await readdir(backupDirectory())) {
      if (/^[a-f0-9-]{36}\.json$/u.test(name)) {
        const entry = await readJson<BackupEntry | null>(join(backupDirectory(), name), null);
        if (entry) entries.push(this.publicEntry(entry));
      }
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async detail(id: string) { return this.publicEntry(await this.entry(id)); }
  async job(id: string) {
    const job = await readJson<BackupJob | null>(backupPath(id, "job"), null);
    if (!job) throw new NotFoundException("BACKUP_JOB_NOT_FOUND");
    return job;
  }
  private async audit(action: string, actorId: string | null, resourceId?: string) {
    await this.prisma.auditEvent.create({ data: { action: `backup.${action}`, actorId, resourceType: "backup", resourceId } });
  }
  async verifyPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, disabledAt: true } });
    if (!user || user.disabledAt || !(await verify(user.passwordHash, password))) throw new ForbiddenException("BACKUP_CURRENT_PASSWORD_INVALID");
  }
  async savePolicy(input: Omit<BackupPolicy, "password" | "lastSlot"> & { password?: string }, actorId: string) {
    return this.withLock(async () => {
      await this.assertIdle();
      const previous = await this.policy();
      const { password, ...options } = input;
      const policy: BackupPolicy = { ...previous, ...options, ...(password ? { password: this.wrap(password, "backup-policy") } : {}) };
      if (policy.enabled && !policy.password) throw new BadRequestException("BACKUP_PASSWORD_REQUIRED");
      await atomicJson(this.policyPath(), policy);
      await this.audit("policy", actorId);
      return this.policyView();
    });
  }
  async update(id: string, name: string, note: string, actorId: string) {
    return this.withLock(async () => { await this.assertIdle(); const entry = await this.entry(id); entry.name = name; entry.note = note; await this.saveEntry(entry); await this.audit("update", actorId, id); return this.publicEntry(entry); });
  }
  async remove(id: string, actorId: string) {
    return this.withLock(async () => {
      await this.assertIdle();
      const entry = await this.entry(id);
      if (entry.status === "running") throw new ConflictException("BACKUP_BUSY");
      await this.audit("delete", actorId, id);
      await rm(backupPath(id), { force: true }); await rm(backupPath(id, "json"), { force: true });
      return { ok: true };
    });
  }
  async download(id: string, actorId: string) {
    const release = await this.runtime.enterWrite();
    try {
      const entry = await this.entry(id);
      if (entry.status !== "ready") throw new ConflictException("BACKUP_NOT_READY");
      await this.audit("download", actorId, id);
      return { path: backupPath(id), filename: `netsentinel-${entry.createdAt.slice(0, 10)}-${id}.nsbackup` };
    } finally { await release(); }
  }
  async assertIdle(): Promise<void> {
    if (await this.runtime.redis.exists(RESTORE_GATE)) throw new ConflictException("BACKUP_BUSY");
  }
  private async start(type: BackupJob["type"], action: (job: BackupJob) => Promise<void>): Promise<BackupJob> {
    // Acquire before returning 202: no silently queued competing operation.
    let accepted!: () => void;
    let rejected!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { accepted = resolve; rejected = reject; });
    const job: BackupJob = { id: randomUUID(), type, status: "running", phase: "preparing", createdAt: new Date().toISOString() };
    const operation = this.withLock(async () => {
      await this.assertIdle();
      await atomicJson(backupPath(job.id, "job"), job);
      accepted();
      try {
        await action(job);
        job.status = "succeeded"; job.phase = "complete";
      } catch (error) {
        job.status = "failed"; job.error = safeError(error);
        console.error(JSON.stringify({ event: "backup.job.failed", jobId: job.id, code: job.error }));
      }
      job.finishedAt = new Date().toISOString();
      await atomicJson(backupPath(job.id, "job"), job);
    }).then(() => undefined, (error) => {
      rejected(error);
      // Do not include driver messages, decrypted records or credentials.
      console.error(JSON.stringify({ event: "backup.operation.failed", jobId: job.id, code: safeError(error) }));
    });
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation));
    await ready;
    return { ...job };
  }
  async create(name: string, note: string, actorId: string | null, source: BackupSource = "manual") {
    if (!(await this.policy()).password) throw new BadRequestException("BACKUP_PASSWORD_REQUIRED");
    return this.start("create", async (job) => {
      const policy = await this.policy();
      if (!policy.password) throw new BadRequestException("BACKUP_PASSWORD_REQUIRED");
      const entry = await this.createSnapshot(name, note, actorId, source, this.unwrap(policy.password, "backup-policy"));
      job.backupId = entry.id;
      if (source === "scheduled") await this.prune(policy.retain);
    });
  }
  private async createSnapshot(name: string, note: string, actorId: string | null, source: BackupSource, password: string) {
    const id = randomUUID();
    const entry: BackupEntry = { id, name, note, source, createdAt: new Date().toISOString(), status: "running", size: 0, formatVersion: 1 };
    await this.saveEntry(entry);
    const stage = join(backupDirectory(), `stage-${id}`);
    try {
      await requireDiskSpace(128 * 1024 * 1024);
      await this.runtime.waitWriters(true);
      await writeArchive(backupPath(id, "partial"), password, snapshotRecords(this.prisma, process.env.NETSENTINEL_MASTER_KEY!));
      const validated = await validateArchive(backupPath(id, "partial"), password, stage);
      await rename(backupPath(id, "partial"), backupPath(id));
      Object.assign(entry, { status: "ready", size: (await stat(backupPath(id))).size, counts: validated.counts,
        schemaFingerprint, dataTime: validated.manifest.createdAt, archivePassword: this.wrap(password, id) });
      await this.saveEntry(entry);
      await this.audit("create", actorId, id);
      return entry;
    } catch (error) {
      await this.saveEntry({ ...entry, status: "failed", error: safeError(error) });
      await rm(backupPath(id, "partial"), { force: true });
      throw error;
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  async import(path: string, password: string, name: string, actorId: string) {
    return this.start("import", async (job) => {
      const id = randomUUID();
      const stage = join(backupDirectory(), `stage-${id}`);
      try {
        await requireDiskSpace((await stat(path)).size * 3);
        const validated = await validateArchive(path, password, stage);
        await rename(path, backupPath(id));
        const entry: BackupEntry = { id, name, note: "", source: "import", createdAt: new Date().toISOString(), status: "ready", size: (await stat(backupPath(id))).size,
          formatVersion: 1, schemaFingerprint, counts: validated.counts, dataTime: validated.manifest.createdAt, archivePassword: this.wrap(password, id) };
        await this.saveEntry(entry); job.backupId = id;
        await this.audit("import", actorId, id);
      } finally { await rm(stage, { recursive: true, force: true }); await rm(path, { force: true }); }
    });
  }
  private async pauseQueues() { await Promise.all([this.queues.probe.pause(), this.queues.workflow.pause()]); }
  private async releaseGate(id: string) {
    // Resume before removing the gate: Worker callbacks are fenced until both
    // queues and the durable journal are in a consistent state.
    await Promise.all([this.queues.probe.resume(), this.queues.workflow.resume()]);
    await this.runtime.redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, RESTORE_GATE, id);
  }
  private writeJournal(journal: RestoreJournal) { return atomicJson(this.journalPath(), journal); }
  private async drain() {
    const deadline = Date.now() + configuredLimit("NETSENTINEL_RESTORE_DRAIN_TIMEOUT_MS", 10 * 60_000);
    await this.runtime.waitWriters(false, Math.max(1000, deadline - Date.now()));
    while (Date.now() < deadline) {
      const workers = await this.runtime.redis.keys("netsentinel:worker:restore-aware:*");
      const values = workers.length ? await this.runtime.redis.mget(...workers) : [];
      const active = (await this.queues.probe.getActiveCount()) + (await this.queues.workflow.getActiveCount());
      // A worker without the new drain protocol cannot safely restore.
      const connected = (await this.queues.probe.getWorkers()).length;
      if (connected > values.length) { await pause(1000); if ((await this.runtime.redis.keys("netsentinel:worker:restore-aware:*")).length < connected) throw new Error("BACKUP_WORKER_UPGRADE_REQUIRED"); }
      if (!active && values.every((value) => value === "idle")) return;
      await pause(200);
    }
    throw new Error("BACKUP_DRAIN_TIMEOUT");
  }
  async restore(id: string, actorId: string) {
    const entry = await this.entry(id);
    if (entry.status !== "ready" || !entry.archivePassword) throw new ConflictException("BACKUP_NOT_READY");
    return this.start("restore", async (job) => {
      const policy = await this.policy();
      if (!policy.password) throw new BadRequestException("BACKUP_PASSWORD_REQUIRED");
      job.backupId = id;
      const stage = join(backupDirectory(), `restore-${job.id}`);
      let gate = false;
      let journal: RestoreJournal | undefined;
      let committed = false;
      try {
        const liveEntry = await this.entry(id);
        const validated = await validateArchive(backupPath(id), this.unwrap(liveEntry.archivePassword, id), stage);
        await this.assertRestorableAdmin(stage);
        await syncAvatarStage(stage);
        await requireDiskSpace(validated.bytes * 2 + entry.size * 2);
        if (!(await this.runtime.redis.set(RESTORE_GATE, job.id, "NX"))) throw new ConflictException("BACKUP_BUSY");
        gate = true;
        job.phase = "draining"; await atomicJson(backupPath(job.id, "job"), job);
        await this.pauseQueues(); await this.drain();
        await this.runtime.redis.publish("netsentinel:agents:disconnect", "restore");
        const protection = await this.createSnapshot("Before restore", "Automatic recovery protection", actorId, "protection", this.unwrap(policy.password, "backup-policy"));
        journal = { id: job.id, backupId: id, stage, oldAvatars: join(dataDirectory(), `avatars-before-${job.id}`), phase: "prepared", protectionId: protection.id, actorId };
        await this.writeJournal(journal);
        job.phase = "restoring"; await atomicJson(backupPath(job.id, "job"), job);
        await restoreDatabase(this.prisma, stage, validated, job.id);
        committed = true;
        journal.phase = "database"; await this.writeJournal(journal);
        await this.finishRestore(journal);
      } finally {
        if (!committed) {
          // Query checkpoint even if commit acknowledgement was lost.
          const marker = await this.prisma.setting.findUnique({ where: { key: CHECKPOINT_KEY } });
          if (marker?.value === job.id && journal) await this.finishRestore(journal);
          else {
            if (journal) await this.writeJournal({ ...journal, phase: "complete" });
            if (gate) await this.releaseGate(job.id);
            await rm(stage, { recursive: true, force: true });
          }
        }
        // Post-commit errors intentionally leave the durable gate in place;
        // restart uses the checkpoint to finish, never reopens mixed data.
      }
    });
  }
  private async assertRestorableAdmin(stage: string) {
    const { stagedRows } = await import("./backup-database.js");
    const roles = new Set<string>();
    for await (const row of stagedRows(stage, "Role")) {
      if ((row.permissions as string[]).includes("backup:manage") && (row.permissions as string[]).includes("user:manage")) roles.add(String(row.id));
    }
    const users = new Set<string>();
    for await (const row of stagedRows(stage, "UserRole")) if (roles.has(String(row.roleId))) users.add(String(row.userId));
    for await (const row of stagedRows(stage, "User")) if (users.has(String(row.id)) && row.disabledAt === null) return;
    throw new Error("BACKUP_ADMIN_MISSING");
  }
  private async finishRestore(journal: RestoreJournal) {
    const current = join(dataDirectory(), "avatars");
    const staged = join(journal.stage, "avatars");
    if (existsSync(staged)) {
      if (existsSync(current) && !existsSync(journal.oldAvatars)) await rename(current, journal.oldAvatars);
      await rename(staged, current);
    } else if (!existsSync(current)) throw new Error("BACKUP_AVATAR_MISSING");
    if (process.platform !== "win32") {
      const { open } = await import("node:fs/promises");
      const directory = await open(dataDirectory(), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
    journal.phase = "avatars"; await this.writeJournal(journal);
    // Only our two queues; no FLUSHDB and no execution replay.
    await this.queues.probe.obliterate({ force: false });
    await this.queues.workflow.obliterate({ force: false });
    await this.audit("restore", journal.actorId, journal.backupId);
    await rm(journal.oldAvatars, { recursive: true, force: true });
    await rm(journal.stage, { recursive: true, force: true });
    journal.phase = "complete"; await this.writeJournal(journal);
    await this.releaseGate(journal.id);
  }
  private async prune(retain: number) {
    const scheduled = (await this.list()).filter((e) => e.source === "scheduled" && e.status === "ready");
    for (const entry of scheduled.slice(retain)) {
      await this.audit("retention-delete", null, entry.id);
      await rm(backupPath(entry.id), { force: true }); await rm(backupPath(entry.id, "json"), { force: true });
    }
  }
  private async tick() {
    if (await this.runtime.redis.exists(RESTORE_GATE)) return;
    const policy = await this.policy();
    if (!policy.enabled || !policy.password) return;
    const slot = scheduleSlot(policy);
    if (!slot || slot === policy.lastSlot) return;
    await this.start("create", async (job) => {
      const latest = await this.policy();
      if (!latest.enabled || !latest.password || latest.lastSlot === slot || scheduleSlot(latest) !== slot) return;
      await atomicJson(this.policyPath(), { ...latest, lastSlot: slot });
      const entry = await this.createSnapshot(`Scheduled ${slot}`, "", null, "scheduled", this.unwrap(latest.password, "backup-policy"));
      job.backupId = entry.id;
      await this.prune(latest.retain);
    });
  }
}
