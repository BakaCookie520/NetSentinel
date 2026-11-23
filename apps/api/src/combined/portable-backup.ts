import type { Express, Request } from "express";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import multer, { diskStorage } from "multer";
import { z } from "zod";
import { encryptSecret, decryptSecret, type SecretEnvelope } from "@netsentinel/core";
import { readArchive, writeArchive, uploadLimit } from "../backup-format.js";
import { atomicJson, backupPath, backupDirectory, dataDirectory, readJson, ensureBackupDirectory, requireDiskSpace, syncAvatarStage, syncDirectory } from "../backup-storage.js";
import { detectAvatarImage } from "../avatar-storage.js";
import { type BackupEntry, type BackupPolicy, type BackupJob, DEFAULT_POLICY } from "../backup-types.js";
import { scheduleSlot } from "../backup-service.js";
import { TABLES } from "../backup-database.js";
import { entities, normalizeRow, privateSetting, rowKey, type EntityName, type RecordData, type Mutation } from "../storage/model.js";
import { SqliteAdapter } from "../storage/sqlite.js";
import type { Store } from "../storage/store.js";
import type { ApplicationState } from "./setup.js";
import { requirePermission, type UserRequest } from "./auth-routes.js";
import { passwordMatches } from "./security.js";

const backupEntities: EntityName[] = [...TABLES, "AccountSecurity"];
const logicalSchema = "netsentinel-logical-2";
const legacyFingerprint = "ebbcbb311672dfe1dc5323a978908efe520407c995f1d57080f23f150066ca3e";
interface Manifest { kind: "manifest"; formatVersion: 1 | 2; schemaFingerprint: string; createdAt: string; sourceMasterKey: string; sourceDatabase?: string }
interface Staged { manifest: Manifest; adapter: SqliteAdapter; counts: Record<string, number>; bytes: number }
interface Journal { id: string; stage: string; backupId: string; phase: "prepared" | "committed" | "complete"; oldAvatars: string }
const validAvatar = (key: string) => /^[a-f0-9-]{36}\.(png|jpg|webp)$/u.test(key);
const errorCode = (error: unknown) => error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "BACKUP_OPERATION_FAILED";
async function stageArchive(path: string, password: string, stage: string): Promise<Staged> {
  await mkdir(join(stage, "avatars"), { recursive: true, mode: 0o700 });
  const adapter = await SqliteAdapter.open(join(stage, "validation.sqlite"));
  let manifest: Manifest | undefined; let ended = false; let bytes = 0;
  const counts: Record<string, number> = {}; let countAvatars = 0;
  let batch: Mutation[] = []; const expectedAvatars = new Set<string>(); const foundAvatars = new Set<string>();
  let nextDiskCheck = 0;
  const flush = async () => { if (batch.length) { await adapter.commit(await adapter.revision(), batch); batch = []; } };
  try {
    for await (const raw of readArchive(path, password)) {
      const record = z.record(z.string(), z.unknown()).parse(raw);
      if (ended) throw new Error("BACKUP_FILE_INVALID");
      if (!manifest) {
        const input = z.object({ kind: z.literal("manifest"), formatVersion: z.union([z.literal(1), z.literal(2)]), schemaFingerprint: z.string(), createdAt: z.string().datetime(), sourceMasterKey: z.string(), sourceDatabase: z.string().optional() }).parse(record);
        if (Buffer.from(input.sourceMasterKey, "base64").length !== 32 || (input.formatVersion === 2 ? input.schemaFingerprint !== logicalSchema : input.schemaFingerprint !== legacyFingerprint)) throw new Error("BACKUP_SCHEMA_MISMATCH");
        manifest = input;
        for (const entity of input.formatVersion === 1 ? TABLES : backupEntities) counts[entity] = 0;
      } else if (record.kind === "row") {
        const entity = z.enum(backupEntities as [EntityName, ...EntityName[]]).parse(record.table);
        if (manifest.formatVersion === 1 && entity === "AccountSecurity") throw new Error("BACKUP_UNKNOWN_TABLE");
        const input = z.record(z.string(), z.unknown()).parse(record.data);
        if (entity === "Setting" && privateSetting(input.key)) throw new Error("BACKUP_RESERVED_SETTING");
        const row = normalizeRow(entity, input);
        if (Object.keys(input).length !== Object.keys(row).length) throw new Error("BACKUP_ROW_INVALID");
        if (entity === "Credential") decryptSecret(row.encrypted as SecretEnvelope, Buffer.from(manifest.sourceMasterKey, "base64"), String(row.id));
        if (entity === "AccountSecurity" && row.totpEncrypted) decryptSecret(row.totpEncrypted as SecretEnvelope, Buffer.from(manifest.sourceMasterKey, "base64"), String(row.userId));
        if (entity === "User" && row.avatarKey) { if (!validAvatar(String(row.avatarKey))) throw new Error("BACKUP_AVATAR_INVALID"); expectedAvatars.add(String(row.avatarKey)); }
        const key = rowKey(entity, row);
        if (batch.some((change) => change.entity === entity && change.key === key) || await adapter.get(entity, key)) throw new Error("BACKUP_DUPLICATE");
        batch.push({ entity, key, row }); counts[entity]! += 1; bytes += Buffer.byteLength(JSON.stringify(row));
        if (batch.length >= 100) await flush();
      } else if (record.kind === "avatar") {
        const key = z.string().parse(record.key); const data = z.string().max(2800000).parse(record.data);
        if (!validAvatar(key) || foundAvatars.has(key) || !expectedAvatars.has(key)) throw new Error("BACKUP_AVATAR_INVALID");
        const buffer = Buffer.from(data, "base64");
        if (buffer.toString("base64") !== data || !key.endsWith(`.${detectAvatarImage(buffer).extension}`)) throw new Error("BACKUP_AVATAR_INVALID");
        await writeFile(join(stage, "avatars", key), buffer, { mode: 0o600, flag: "wx" }); foundAvatars.add(key); countAvatars += 1; bytes += buffer.length;
      } else if (record.kind === "end") {
        const declared = z.record(z.string(), z.number().int().nonnegative()).parse(record.counts);
        if (Object.keys(declared).length !== Object.keys(counts).length || Object.entries(counts).some(([entity, count]) => declared[entity] !== count) || record.avatars !== countAvatars) throw new Error("BACKUP_COUNTS_INVALID");
        ended = true;
      } else throw new Error("BACKUP_FILE_INVALID");
      if (bytes >= nextDiskCheck) { await requireDiskSpace(16 * 1024 * 1024, stage); nextDiskCheck = bytes + 16 * 1024 * 1024; }
    }
    await flush();
    if (!manifest || !ended || expectedAvatars.size !== foundAvatars.size || !counts.User) throw new Error("BACKUP_FILE_INVALID");
    let securityCursor: string | undefined;
    do {
      const securityRows = await adapter.list("AccountSecurity", { ...(securityCursor ? { after: securityCursor } : {}), limit: 500 });
      for (const row of securityRows) if (!await adapter.get("User", JSON.stringify([row.userId]))) throw new Error("BACKUP_RELATION_INVALID");
      if (securityRows.length < 500) break;
      securityCursor = rowKey("AccountSecurity", securityRows.at(-1)!);
    } while (true);
    return { manifest, adapter, counts, bytes };
  } catch (error) { await adapter.close(); throw error; }
}
export class PortableBackups {
  busy = false;
  readonly directory = backupDirectory();
  readonly data = dataDirectory();
  path(id: string, extension = "nsbackup") {
    return join(this.directory, `${z.string().uuid().parse(id)}.${z.enum(["nsbackup", "json", "job", "partial"]).parse(extension)}`);
  }
  private timer?: ReturnType<typeof setInterval>;
  private activeJobId?: string;
  private operations = new Set<Promise<void>>();
  constructor(private app: Express, readonly state: ApplicationState) {}
  private store() { if (!this.state.store) throw new Error("SETUP_REQUIRED"); return this.state.store; }
  private policyPath() { return join(this.directory, "policy.json"); }
  async policy(): Promise<BackupPolicy> { return readJson(this.policyPath(), { ...DEFAULT_POLICY }); }
  private wrap(password: string, id: string) { return encryptSecret(password, this.state.config.key, id); }
  private unwrap(value: unknown, id: string) { return decryptSecret(value as SecretEnvelope, this.state.config.key, id); }
  async viewPolicy() { const { password, lastSlot: _slot, ...options } = await this.policy(); return { ...options, passwordConfigured: Boolean(password), uploadMaxBytes: uploadLimit() }; }
  private public(entry: BackupEntry) { const { archivePassword: _secret, ...view } = entry; return view; }
  async entry(id: string) { const entry = await readJson<BackupEntry | null>(this.path(id, "json"), null); if (!entry) throw new Error("NOT_FOUND"); return entry; }
  async list() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 }); const result: ReturnType<PortableBackups["public"]>[] = [];
    for (const file of await readdir(this.directory)) if (/^[a-f0-9-]{36}\.json$/u.test(file)) {
      const entry = await readJson<BackupEntry | null>(join(this.directory, file), null); if (entry) result.push(this.public(entry));
    }
    return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  private async audit(actor: string | null, action: string, id: string | null) { await this.store().transaction((tx) => tx.put("AuditEvent", { actorId: actor, action: `backup.${action}`, resourceType: "backup", resourceId: id })); }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy || this.state.runtime?.restoring) throw new Error("BACKUP_BUSY");
    this.busy = true; this.app.locals.backupBusy = true;
    try { return await operation(); } finally { this.busy = false; this.app.locals.backupBusy = false; }
  }
  async job(id: string): Promise<BackupJob> {
    const job = await readJson<BackupJob | null>(this.path(id, "job"), null);
    if (!job) throw new Error("NOT_FOUND");
    if (this.activeJobId === id && job.status !== "running") {
      return { ...job, status: "running", phase: "finalizing", finishedAt: undefined, error: undefined };
    }
    return job;
  }
  async start(type: BackupJob["type"], action: (job: BackupJob) => Promise<void>) {
    if (this.busy || this.state.runtime?.restoring) throw new Error("BACKUP_BUSY");
    const job: BackupJob = { id: randomUUID(), type, status: "running", phase: "preparing", createdAt: new Date().toISOString() };
    this.busy = true; this.app.locals.backupBusy = true;
    try { await atomicJson(this.path(job.id, "job"), job); }
    catch (error) { this.busy = false; this.app.locals.backupBusy = false; throw error; }
    this.activeJobId = job.id;
    const started = { ...job };
    const operation = (async () => {
      try { await action(job); job.status = "succeeded"; job.phase = "complete"; }
      catch (error) { job.status = "failed"; job.error = errorCode(error); }
      finally {
        job.finishedAt = new Date().toISOString();
        try { await atomicJson(this.path(job.id, "job"), job); }
        finally { this.activeJobId = undefined; this.busy = false; this.app.locals.backupBusy = false; }
      }
    })();
    this.operations.add(operation);
    void operation.then(() => this.operations.delete(operation), (error: unknown) => {
      this.operations.delete(operation);
      const code = (error as NodeJS.ErrnoException)?.code;
      console.error(`BACKUP_JOB_FINALIZATION_FAILED:${typeof code === "string" && /^[A-Z]+$/u.test(code) ? code : "UNKNOWN"}`);
    });
    return started;
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let recoveredJob: string | undefined;
    if (this.state.store) {
      const journal = await readJson<Journal | null>(join(this.directory, "portable-restore.json"), null);
      if (journal && journal.phase !== "complete") {
        const checkpoint = await this.store().get("Setting", "__restoreCheckpoint");
        if (checkpoint?.value === journal.id) { await this.finish(journal); recoveredJob = journal.id; }
        else { await rm(journal.stage, { recursive: true, force: true }); await atomicJson(join(this.directory, "portable-restore.json"), { ...journal, phase: "complete" }); }
      }
    }
    for (const file of await readdir(this.directory)) {
      if (/^[a-f0-9-]{36}\.job$/u.test(file)) {
        const path = join(this.directory, file); const job = await readJson<BackupJob | null>(path, null);
        if (job?.status === "running") await atomicJson(path, { ...job, status: job.id === recoveredJob ? "succeeded" : "failed", phase: job.id === recoveredJob ? "complete" : "interrupted", error: job.id === recoveredJob ? undefined : "BACKUP_INTERRUPTED", finishedAt: new Date().toISOString() });
      }
    }
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, 30000); this.timer.unref();
  }
  async close() { if (this.timer) clearInterval(this.timer); await Promise.allSettled(this.operations); }
  private async *records(store: Store) {
    const manifest: Manifest = { kind: "manifest", formatVersion: 2, schemaFingerprint: logicalSchema, createdAt: new Date().toISOString(), sourceMasterKey: this.state.config.key.toString("base64"), sourceDatabase: store.adapter.kind };
    yield manifest; const counts: Record<string, number> = {}; const avatars = new Set<string>();
    for (const entity of backupEntities) {
      counts[entity] = 0;
      for await (const row of store.iterate(entity)) {
        if (entity === "Setting" && privateSetting((row as RecordData).key)) continue;
        yield { kind: "row", table: entity, data: row }; counts[entity]! += 1;
        if (entity === "User" && (row as RecordData).avatarKey) avatars.add(String((row as RecordData).avatarKey));
      }
    }
    for (const key of avatars) { if (!validAvatar(key)) throw new Error("BACKUP_AVATAR_INVALID"); const buffer = await readFile(join(this.data, "avatars", key)); detectAvatarImage(buffer); yield { kind: "avatar", key, data: buffer.toString("base64") }; }
    yield { kind: "end", counts, avatars: avatars.size };
  }
  private async snapshot(name: string, note: string, source: BackupEntry["source"], actor: string | null): Promise<BackupEntry> {
    await this.store().transaction(async () => undefined);
    const policy = await this.policy(); if (!policy.password) throw new Error("BACKUP_PASSWORD_REQUIRED");
    const password = this.unwrap(policy.password, "backup-policy");
    const id = randomUUID(); const entry: BackupEntry = { id, name, note, source, status: "running", createdAt: new Date().toISOString(), formatVersion: 2, size: 0 };
    const stage = join(this.directory, `portable-stage-${id}`);
    await atomicJson(this.path(id, "json"), entry);
    try {
      await requireDiskSpace(128 * 1024 * 1024, this.directory);
      await writeArchive(this.path(id, "partial"), password, this.records(this.store()));
      const validated = await stageArchive(this.path(id, "partial"), password, stage); await validated.adapter.close();
      await rename(this.path(id, "partial"), this.path(id));
      Object.assign(entry, { status: "ready", size: (await stat(this.path(id))).size, counts: validated.counts, dataTime: validated.manifest.createdAt, schemaFingerprint: logicalSchema, archivePassword: this.wrap(password, id) });
      await atomicJson(this.path(id, "json"), entry); await this.audit(actor, "create", id); return entry;
    } catch (error) { await atomicJson(this.path(id, "json"), { ...entry, status: "failed", error: errorCode(error) }); throw error; }
    finally { await rm(stage, { recursive: true, force: true }); await rm(this.path(id, "partial"), { force: true }); }
  }
  async create(name: string, note: string, actor: string | null, source: BackupEntry["source"] = "manual") {
    return this.start("create", async (job) => {
      const runtime = this.state.runtime!; await (this.app.locals.drainWrites as () => Promise<void>)();
      try {
        await runtime.drain(); job.backupId = (await this.snapshot(name, note, source, actor)).id;
        if (source === "scheduled") {
          const policy = await this.policy();
          const copies = (await this.list()).filter((entry) => entry.source === "scheduled" && entry.status === "ready");
          for (const entry of copies.slice(policy.retain)) {
            await this.audit(null, "retention-delete", entry.id);
            await rm(this.path(entry.id), { force: true }); await rm(this.path(entry.id, "json"), { force: true });
          }
        }
      }
      finally { runtime.paused = false; }
    });
  }
  async import(path: string, password: string, name: string, actor: string) {
    return this.start("import", async (job) => {
      const id = randomUUID(); const stage = join(this.directory, `portable-stage-${id}`);
      try {
        const validated = await stageArchive(path, password, stage); await validated.adapter.close();
        await rename(path, this.path(id));
        const entry: BackupEntry = { id, name, note: validated.manifest.formatVersion === 1 ? "Converted from legacy logical backup" : "", source: "import", status: "ready", size: (await stat(this.path(id))).size, formatVersion: validated.manifest.formatVersion, schemaFingerprint: logicalSchema, counts: validated.counts, dataTime: validated.manifest.createdAt, createdAt: new Date().toISOString(), archivePassword: this.wrap(password, id) };
        await atomicJson(this.path(id, "json"), entry); await this.audit(actor, "import", id); job.backupId = id;
      } finally { await rm(path, { force: true }); await rm(stage, { recursive: true, force: true }); }
    });
  }
  async restore(id: string, actor: string) {
    return this.start("restore", async (job) => {
      const entry = await this.entry(id); const stage = join(this.directory, `portable-restore-${job.id}`); const runtime = this.state.runtime!;
      let validated: Staged | undefined; let committed = false; let journal: Journal | undefined;
      try {
        validated = await stageArchive(this.path(id), this.unwrap(entry.archivePassword, id), stage);
        await requireDiskSpace(validated.bytes * 3 + entry.size, this.directory); await syncAvatarStage(stage);
        const validRoles = (await validated.adapter.list("Role", { limit: 10000 })).filter((role) => (role.permissions as string[]).includes("user:manage"));
        const links = await validated.adapter.list("UserRole", { limit: 10000 });
        const users = await validated.adapter.list("User", { limit: 10000 });
        if (!users.some((user) => !user.disabledAt && links.some((link) => link.userId === user.id && validRoles.some((role) => role.id === link.roleId)))) throw new Error("BACKUP_ADMIN_MISSING");
        runtime.restoring = true; await (this.app.locals.drainWrites as () => Promise<void>)(); await runtime.drain();
        runtime.events.emit("agents.disconnect");
        await this.snapshot("Before restore", "Automatic protection", "protection", actor);
        journal = { id: job.id, stage, backupId: id, phase: "prepared", oldAvatars: join(this.data, `avatars-before-${job.id}`) };
        await atomicJson(join(this.directory, "portable-restore.json"), journal);
        const sourceKey = Buffer.from(validated.manifest.sourceMasterKey, "base64");
        const stagedStore = new (await import("../storage/store.js")).Store(validated.adapter);
        await this.store().transaction(async (tx) => {
          const lease = await tx.get("Setting", "__runtimeOwner");
          for (const entity of ["Session", "DurableJob", "AccountSecurity", ...[...TABLES].reverse()] as EntityName[]) {
            for (const row of await tx.list(entity)) if (entity !== "Setting" || (row as RecordData).key !== "__runtimeOwner") await tx.remove(entity, row as RecordData);
          }
          for (const entity of backupEntities) for await (const input of stagedStore.iterate(entity)) {
            const row = { ...input } as RecordData;
            if (entity === "Credential") row.encrypted = encryptSecret(decryptSecret(row.encrypted as SecretEnvelope, sourceKey, String(row.id)), this.state.config.key, String(row.id));
            if (entity === "AccountSecurity" && row.totpEncrypted) row.totpEncrypted = encryptSecret(decryptSecret(row.totpEncrypted as SecretEnvelope, sourceKey, String(row.userId)), this.state.config.key, String(row.userId));
            if (entity === "Agent" && row.status !== "REVOKED") { row.status = "OFFLINE"; row.lastSeenAt = null; }
            if (entity === "Monitor") row.nextCheckAt = new Date(Date.now() + Number(row.intervalSeconds) * 1000).toISOString();
            if (["StepRun", "WorkflowRun"].includes(entity) && ["PENDING", "RUNNING"].includes(String(row.status))) { row.status = row.status === "RUNNING" ? "UNKNOWN" : "CANCELLED"; row.finishedAt = new Date().toISOString(); }
            if (entity === "Approval" && row.status === "PENDING") { row.status = "CANCELLED"; row.decidedAt = new Date().toISOString(); }
            await tx.put(entity, row);
          }
          if (lease) await tx.put("Setting", lease);
          await tx.put("Setting", { key: "__initialized", value: true });
          await tx.put("Setting", { key: "__restoreCheckpoint", value: job.id });
        });
        sourceKey.fill(0); committed = true;
        journal.phase = "committed"; await atomicJson(join(this.directory, "portable-restore.json"), journal);
        await validated.adapter.close(); validated = undefined;
        await this.finish(journal); job.backupId = id;
      } finally {
        await validated?.adapter.close();
        if (!committed) {
          const marker = await this.store().get("Setting", "__restoreCheckpoint");
          if (marker?.value === job.id && journal) await this.finish(journal);
          else { await rm(stage, { recursive: true, force: true }); if (journal) await atomicJson(join(this.directory, "portable-restore.json"), { ...journal, phase: "complete" }); }
        }
        if (!committed || (await readJson<Journal | null>(join(this.directory, "portable-restore.json"), null))?.phase === "complete") { runtime.restoring = false; runtime.paused = false; }
      }
    });
  }
  private async finish(journal: Journal) {
    const current = join(this.data, "avatars"); const staged = join(journal.stage, "avatars");
    if (existsSync(staged)) { if (existsSync(current) && !existsSync(journal.oldAvatars)) await rename(current, journal.oldAvatars); await rename(staged, current); }
    else if (!existsSync(current)) throw new Error("BACKUP_AVATAR_MISSING");
    await syncDirectory(this.data);
    await rm(journal.oldAvatars, { recursive: true, force: true }); await rm(journal.stage, { recursive: true, force: true });
    await this.audit(null, "restore", journal.backupId);
    await atomicJson(join(this.directory, "portable-restore.json"), { ...journal, phase: "complete" });
  }
  private async tick() {
    if (!this.state.config.state.initialized || this.busy) return;
    const policy = await this.policy(); const slot = policy.enabled ? scheduleSlot(policy) : null;
    if (!slot || policy.lastSlot === slot || !policy.password) return;
    await atomicJson(this.policyPath(), { ...policy, lastSlot: slot });
    await this.create(`Scheduled ${slot}`, "", null, "scheduled");
  }
  async verifyPassword(request: UserRequest) {
    if (request.principal.authentication !== "session") throw new Error("AUTH_SESSION_REQUIRED");
    const { currentPassword } = z.object({ currentPassword: z.string().min(1).max(1024) }).parse(request.body);
    const user = await this.store().get("User", request.principal.id);
    if (!user || !await passwordMatches(user.passwordHash, currentPassword)) throw new Error("AUTH_INVALID");
  }
  async auditDownload(id: string, actor: string) {
    if (this.busy || this.state.runtime?.restoring) throw new Error("BACKUP_BUSY");
    await this.audit(actor, "download", id);
  }
  async savePolicy(input: BackupPolicy & { password?: string }, actor: string) {
    return this.exclusive(async () => {
      const previous = await this.policy(); const { password, ...options } = input;
      const policy = { ...previous, ...options, ...(password ? { password: this.wrap(password, "backup-policy") } : {}) };
      if (policy.enabled && !policy.password) throw new Error("BACKUP_PASSWORD_REQUIRED");
      await atomicJson(this.policyPath(), policy); await this.audit(actor, "policy", null); return this.viewPolicy();
    });
  }
  async edit(id: string, name: string, note: string, actor: string) { return this.exclusive(async () => { const entry = await this.entry(id); await atomicJson(this.path(id, "json"), { ...entry, name, note }); await this.audit(actor, "update", id); return this.public({ ...entry, name, note }); }); }
  async remove(id: string, actor: string) { return this.exclusive(async () => { await this.entry(id); await this.audit(actor, "delete", id); await rm(this.path(id), { force: true }); await rm(this.path(id, "json"), { force: true }); return { ok: true }; }); }
}
export function mountPortableBackups(app: Express, state: ApplicationState) {
  const backups = new PortableBackups(app, state); app.locals.backups = backups;
  app.use("/api/v1/admin/backups", requirePermission("backup:manage"), (request, _response, next) => { if ((request as UserRequest).principal.authentication !== "session") next(new Error("AUTH_SESSION_REQUIRED")); else next(); });
  app.get("/api/v1/admin/backups", async (_request, response) => response.json(await backups.list()));
  app.get("/api/v1/admin/backups/policy", async (_request, response) => response.json(await backups.viewPolicy()));
  app.put("/api/v1/admin/backups/policy", async (request, response) => {
    const input = z.object({ enabled: z.boolean(), frequency: z.enum(["daily", "weekly"]), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u), weekday: z.number().int().min(0).max(6), timezone: z.string().refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }), retain: z.number().int().min(1).max(365), password: z.string().min(12).max(1024).optional() }).parse(request.body);
    response.json(await backups.savePolicy(input, (request as UserRequest).principal.id));
  });
  app.get("/api/v1/admin/backups/jobs/:id", async (request, response) => response.json(await backups.job(String(request.params.id))));
  app.post("/api/v1/admin/backups", async (request, response) => { const input = z.object({ name: z.string().trim().min(1).max(120), note: z.string().max(2000).default("") }).parse(request.body); response.status(202).json(await backups.create(input.name, input.note, (request as UserRequest).principal.id)); });
  app.post("/api/v1/admin/backups/import", multer({ storage: diskStorage({ destination: (_req, _file, callback) => callback(null, backups.directory), filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`) }), limits: { fileSize: uploadLimit(), files: 1, fields: 2 } }).single("file"), async (request, response) => {
    try {
      if (!request.file) throw new Error("BACKUP_FILE_INVALID");
      const input = z.object({ name: z.string().trim().min(1).max(120), password: z.string().max(1024) }).parse(request.body);
      response.status(202).json(await backups.import(request.file.path, input.password, input.name, (request as UserRequest).principal.id));
    } catch (error) { if (request.file) await rm(request.file.path, { force: true }); throw error; }
  });
  app.get("/api/v1/admin/backups/:id", async (request, response) => { const { archivePassword: _password, ...entry } = await backups.entry(String(request.params.id)); response.json(entry); });
  app.patch("/api/v1/admin/backups/:id", async (request: Request, response) => { const input = z.object({ name: z.string().min(1).max(120), note: z.string().max(2000) }).parse(request.body); response.json(await backups.edit(String(request.params.id), input.name, input.note, (request as UserRequest).principal.id)); });
  app.delete("/api/v1/admin/backups/:id", async (request: Request, response) => response.json(await backups.remove(String(request.params.id), (request as UserRequest).principal.id)));
  app.post("/api/v1/admin/backups/:id/download", async (request: Request, response) => {
    await backups.verifyPassword(request as UserRequest); const entry = await backups.entry(String(request.params.id));
    if (entry.status !== "ready") throw new Error("BACKUP_NOT_READY");
    await backups.auditDownload(entry.id, (request as UserRequest).principal.id);
    response.setHeader("Cache-Control", "private, no-store"); response.setHeader("Content-Disposition", `attachment; filename="netsentinel-${entry.id}.nsbackup"`);
    response.type("application/octet-stream"); const stream = createReadStream(backups.path(entry.id)); stream.on("error", () => response.destroy()); response.on("close", () => stream.destroy()); stream.pipe(response);
  });
  app.post("/api/v1/admin/backups/:id/restore", async (request: Request, response) => {
    z.object({ confirmation: z.literal("RESTORE") }).parse(request.body); await backups.verifyPassword(request as UserRequest);
    response.status(202).json(await backups.restore(String(request.params.id), (request as UserRequest).principal.id));
  });
}
