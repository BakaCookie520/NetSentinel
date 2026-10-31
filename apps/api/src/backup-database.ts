import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { Prisma } from "@netsentinel/database";
import { decryptSecret, encryptSecret, type SecretEnvelope } from "@netsentinel/core";
import { detectAvatarImage } from "./avatar-storage.js";
import { dataDirectory, requireDiskSpace } from "./backup-storage.js";
import { readArchive } from "./backup-format.js";
import type { PrismaService } from "./prisma.service.js";

const models = Prisma.dmmf.datamodel.models;
const enums = Prisma.dmmf.datamodel.enums;
export const CHECKPOINT_KEY = "_backupRestoreCheckpoint";
// This order follows actual FKs; reverse order is safe for deletion.
export const TABLES = ["Role", "User", "UserRole", "ApiToken", "Tag", "Credential", "Monitor", "MonitorTag", "Workflow", "WorkflowStep", "Incident", "IncidentComment", "ProbeResult", "StatusDailyMetric", "WorkflowRun", "StepRun", "Approval", "MaintenanceWindow", "Agent", "AuditEvent", "Setting"] as const;
export const schemaFingerprint = createHash("sha256").update(JSON.stringify(Prisma.dmmf.datamodel)).digest("hex");
export interface BackupManifest {
  kind: "manifest";
  formatVersion: 1;
  schemaFingerprint: string;
  createdAt: string;
  applicationVersion: string;
  sourceMasterKey: string;
}
type Row = Record<string, unknown>;
interface Delegate {
  findMany(args: unknown): Promise<Row[]>;
  createMany(args: unknown): Promise<unknown>;
  deleteMany(args?: unknown): Promise<unknown>;
}
function delegate(tx: Prisma.TransactionClient, table: string): Delegate {
  return (tx as unknown as Record<string, Delegate>)[table[0]!.toLowerCase() + table.slice(1)]!;
}
function modelFor(table: string) {
  const model = models.find((item) => item.name === table);
  if (!model || !(TABLES as readonly string[]).includes(table)) throw new Error("BACKUP_UNKNOWN_TABLE");
  return model;
}
function primaryFields(table: string): string[] {
  const model = modelFor(table);
  return [...(model.primaryKey?.fields ?? model.fields.filter((field) => field.isId).map((field) => field.name))];
}
export function validateRow(table: string, value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BACKUP_ROW_INVALID");
  const row = value as Row;
  const fields = modelFor(table).fields.filter((field) => field.kind !== "object");
  if (Object.keys(row).length !== fields.length) throw new Error("BACKUP_ROW_INVALID");
  for (const field of fields) {
    if (!Object.hasOwn(row, field.name)) throw new Error("BACKUP_ROW_INVALID");
    const v = row[field.name];
    if (v === null && !field.isRequired) continue;
    const validScalar = (item: unknown): boolean => {
      if (field.kind === "enum") return enums.find((e) => e.name === field.type)?.values.some((e) => e.name === item) ?? false;
      switch (field.type) {
        case "String": return typeof item === "string";
        case "Boolean": return typeof item === "boolean";
        case "Int": return typeof item === "number" && Number.isInteger(item) && item >= -2147483648 && item <= 2147483647;
        case "Float": return typeof item === "number" && Number.isFinite(item);
        case "DateTime": return typeof item === "string" && /^\d{4}-\d\d-\d\dT/u.test(item) && Number.isFinite(Date.parse(item));
        case "Json": return item !== undefined;
        default: return false;
      }
    };
    if (field.isList ? !Array.isArray(v) || !v.every(validScalar) : !validScalar(v)) throw new Error("BACKUP_ROW_INVALID");
  }
  if (table === "Setting" && row.key === CHECKPOINT_KEY) throw new Error("BACKUP_RESERVED_SETTING");
  return row;
}
export async function* snapshotRecords(prisma: PrismaService, sourceMasterKey: string): AsyncGenerator<unknown> {
  // A bounded producer bridges the transaction callback and archive stream;
  // the transaction stays open until every row has been consumed.
  let next: (() => void) | undefined;
  let consumed: (() => void) | undefined;
  let record: unknown;
  let finished = false;
  let failure: unknown;
  let cancelled = false;
  const push = async (value: unknown) => {
    if (cancelled) throw new Error("BACKUP_CANCELLED");
    record = value;
    const wait = new Promise<void>((resolve) => { consumed = resolve; });
    next?.(); next = undefined;
    await wait;
    if (cancelled) throw new Error("BACKUP_CANCELLED");
  };
  const task = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const manifest: BackupManifest = { kind: "manifest", formatVersion: 1, schemaFingerprint,
      createdAt: new Date().toISOString(), applicationVersion: "0.1.0", sourceMasterKey };
    await push(manifest);
    const counts: Record<string, number> = {};
    const avatars = new Set<string>();
    for (const table of TABLES) {
      counts[table] = 0;
      const fields = primaryFields(table);
      let cursor: Record<string, unknown> | undefined;
      while (true) {
        const rows = await delegate(tx, table).findMany({ take: 500, orderBy: fields.map((field) => ({ [field]: "asc" })),
          ...(table === "Setting" ? { where: { key: { not: CHECKPOINT_KEY } } } : {}),
          ...(cursor ? { cursor, skip: 1 } : {}) });
        if (!rows.length) break;
        for (const row of rows) {
          await push({ kind: "row", table, data: row });
          counts[table]! += 1;
          if (table === "User" && typeof row.avatarKey === "string") avatars.add(row.avatarKey);
        }
        const last = rows.at(-1)!;
        cursor = fields.length === 1 ? { [fields[0]!]: last[fields[0]!] } : {
          [modelFor(table).primaryKey?.name ?? fields.join("_")]: Object.fromEntries(fields.map((field) => [field, last[field]])),
        };
      }
    }
    for (const key of avatars) {
      if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/u.test(key)) throw new Error("BACKUP_AVATAR_INVALID");
      const buffer = await readFile(join(dataDirectory(), "avatars", key));
      detectAvatarImage(buffer);
      await push({ kind: "avatar", key, data: buffer.toString("base64") });
    }
    await push({ kind: "end", counts, avatars: avatars.size });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30 * 60_000 });
  void task.then(() => { finished = true; next?.(); }, (error) => { failure = error; finished = true; next?.(); });
  try {
    while (!finished) {
      if (record === undefined) await new Promise<void>((resolve) => { next = resolve; });
      if (record !== undefined) {
        const current = record; record = undefined;
        yield current;
        consumed?.(); consumed = undefined;
      }
    }
    if (failure) throw failure;
  } finally { cancelled = true; consumed?.(); await task.catch(() => undefined); }
}
export interface ValidatedBackup { manifest: BackupManifest; counts: Record<string, number>; bytes: number; avatars: number }
export async function validateArchive(path: string, password: string, stage: string): Promise<ValidatedBackup> {
  await mkdir(join(stage, "avatars"), { recursive: true, mode: 0o700 });
  // Disk-backed uniqueness and FK inventory prevents history size from causing
  // an unbounded JavaScript Set/Map and verifies relations before maintenance.
  const inventory = new DatabaseSync(join(stage, "inventory.sqlite"));
  inventory.exec("PRAGMA journal_mode=OFF; CREATE TABLE keys (model TEXT, fields TEXT, value TEXT, PRIMARY KEY(model,fields,value)); CREATE TABLE refs (model TEXT, fields TEXT, value TEXT); CREATE TABLE avatars (key TEXT PRIMARY KEY, present INTEGER NOT NULL DEFAULT 0)");
  const insertKey = inventory.prepare("INSERT INTO keys VALUES (?,?,?)");
  const insertRef = inventory.prepare("INSERT INTO refs VALUES (?,?,?)");
  const avatarRef = inventory.prepare("INSERT OR IGNORE INTO avatars(key) VALUES (?)");
  let manifest: BackupManifest | undefined;
  let ended = false;
  let avatarCount = 0;
  let bytes = 0;
  let diskCheckAt = 0;
  const counts = Object.fromEntries(TABLES.map((table) => [table, 0]));
  try {
    inventory.exec("BEGIN");
    for await (const record of readArchive(path, password)) {
      if (!record || typeof record !== "object" || Array.isArray(record) || ended) throw new Error("BACKUP_FILE_INVALID");
      const r = record as Row;
      if (!manifest) {
        if (r.kind !== "manifest" || r.formatVersion !== 1 || typeof r.sourceMasterKey !== "string" || Buffer.from(r.sourceMasterKey, "base64").length !== 32 || typeof r.createdAt !== "string" || !Number.isFinite(Date.parse(r.createdAt))) throw new Error("BACKUP_FILE_INVALID");
        if (r.schemaFingerprint !== schemaFingerprint) throw new Error("BACKUP_SCHEMA_MISMATCH");
        manifest = r as unknown as BackupManifest;
        continue;
      }
      if (r.kind === "row" && typeof r.table === "string") {
        const table = r.table;
        const row = validateRow(table, r.data);
        const model = modelFor(table);
        const uniqueFields = [primaryFields(table), ...model.fields.filter((f) => f.isUnique && !f.isId).map((f) => [f.name]), ...model.uniqueFields];
        for (const fields of uniqueFields) {
          if (fields.every((field) => row[field] !== null)) insertKey.run(table, JSON.stringify(fields), JSON.stringify(fields.map((field) => row[field])));
        }
        for (const relation of model.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length)) {
          const values = relation.relationFromFields!.map((field) => row[field]);
          if (values.every((value) => value !== null)) insertRef.run(relation.type, JSON.stringify(relation.relationToFields), JSON.stringify(values));
        }
        if (table === "User" && (typeof row.passwordHash !== "string" || !/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u.test(row.passwordHash))) throw new Error("BACKUP_USER_INVALID");
        if (table === "Credential") {
          const clear = decryptSecret(row.encrypted as SecretEnvelope, Buffer.from(manifest.sourceMasterKey, "base64"), String(row.id));
          if (typeof clear !== "string") throw new Error("BACKUP_CREDENTIAL_INVALID");
        }
        if (table === "User" && row.avatarKey !== null) {
          if (typeof row.avatarKey !== "string" || !/^[a-f0-9-]{36}\.(png|jpg|webp)$/u.test(row.avatarKey)) throw new Error("BACKUP_AVATAR_INVALID");
          avatarRef.run(row.avatarKey);
        }
        const line = `${JSON.stringify(row)}\n`;
        bytes += Buffer.byteLength(line);
        await appendFile(join(stage, `${table}.ndjson`), line, { mode: 0o600 });
        counts[table]! += 1;
      } else if (r.kind === "avatar" && typeof r.key === "string" && typeof r.data === "string") {
        if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/u.test(r.key) || r.data.length > 2800000) throw new Error("BACKUP_AVATAR_INVALID");
        const buffer = Buffer.from(r.data, "base64");
        if (buffer.toString("base64") !== r.data) throw new Error("BACKUP_AVATAR_INVALID");
        const image = detectAvatarImage(buffer);
        if (!r.key.endsWith(`.${image.extension}`)) throw new Error("BACKUP_AVATAR_INVALID");
        const result = inventory.prepare("UPDATE avatars SET present=1 WHERE key=? AND present=0").run(r.key);
        if (result.changes !== 1) throw new Error("BACKUP_AVATAR_INVALID");
        await writeFile(join(stage, "avatars", r.key), buffer, { flag: "wx", mode: 0o600 });
        bytes += buffer.length;
        avatarCount += 1;
      } else if (r.kind === "end") {
        if (JSON.stringify(r.counts) !== JSON.stringify(counts) || r.avatars !== avatarCount) throw new Error("BACKUP_COUNTS_INVALID");
        ended = true;
      } else throw new Error("BACKUP_FILE_INVALID");
      if (bytes >= diskCheckAt) {
        await requireDiskSpace(16 * 1024 * 1024, stage);
        diskCheckAt = bytes + 16 * 1024 * 1024;
      }
    }
    if (!manifest || !ended) throw new Error("BACKUP_FILE_INVALID");
    if (inventory.prepare("SELECT 1 FROM refs r LEFT JOIN keys k ON r.model=k.model AND r.fields=k.fields AND r.value=k.value WHERE k.model IS NULL LIMIT 1").get()) throw new Error("BACKUP_RELATION_INVALID");
    if (inventory.prepare("SELECT 1 FROM avatars WHERE present=0 LIMIT 1").get()) throw new Error("BACKUP_AVATAR_MISSING");
    if (!counts.User || !counts.Role) throw new Error("BACKUP_ADMIN_MISSING");
    inventory.exec("COMMIT");
    return { manifest, counts, bytes, avatars: avatarCount };
  } finally { inventory.close(); }
}
export async function* stagedRows(stage: string, table: string): AsyncGenerator<Row> {
  let stream;
  try { stream = createReadStream(join(stage, `${table}.ndjson`));
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) yield JSON.parse(line) as Row;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  finally { stream?.destroy(); }
}
export async function restoreDatabase(prisma: PrismaService, stage: string, validated: ValidatedBackup, operationId: string): Promise<void> {
  const sourceKey = Buffer.from(validated.manifest.sourceMasterKey, "base64");
  const targetKey = Buffer.from(process.env.NETSENTINEL_MASTER_KEY!, "base64");
  const now = new Date();
  try { await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany();
    for (const table of [...TABLES].reverse()) await delegate(tx, table).deleteMany();
    for (const table of TABLES) {
      let restoredCount = 0;
      let batch: Row[] = [];
      const flush = async () => { if (batch.length) await delegate(tx, table).createMany({ data: batch }); batch = []; };
      for await (const row of stagedRows(stage, table)) {
        restoredCount += 1;
        if (table === "Credential") row.encrypted = encryptSecret(decryptSecret(row.encrypted as SecretEnvelope, sourceKey, String(row.id)), targetKey, String(row.id));
        if (table === "Monitor") row.nextCheckAt = new Date(now.getTime() + Number(row.intervalSeconds) * 1000);
        if (table === "Agent" && row.status !== "REVOKED") { row.status = "OFFLINE"; row.lastSeenAt = null; }
        if (table === "WorkflowRun" || table === "StepRun") {
          if (row.status === "RUNNING" || row.status === "PENDING") {
            row.status = row.status === "RUNNING" ? "UNKNOWN" : "CANCELLED";
            row.finishedAt = now;
            if (table === "StepRun") row.errorMessage = "Interrupted by backup restoration; not replayed";
          }
        }
        if (table === "Approval" && row.status === "PENDING") { row.status = "CANCELLED"; row.decidedAt = now; }
        // JSON null needs Prisma.JsonNull rather than JavaScript null.
        for (const field of modelFor(table).fields.filter((f) => f.type === "Json")) {
          if (row[field.name] === null) row[field.name] = Prisma.JsonNull;
        }
        batch.push(row);
        if (batch.length === 200) await flush();
      }
      await flush();
      if (restoredCount !== (validated.counts[table] ?? 0)) throw new Error("BACKUP_COUNTS_INVALID");
    }
    await tx.setting.create({ data: { key: CHECKPOINT_KEY, value: operationId } });
  }, { timeout: 30 * 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } finally { sourceKey.fill(0); targetKey.fill(0); }
}
