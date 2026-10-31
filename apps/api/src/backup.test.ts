import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeArchive, readArchive } from "./backup-format.js";
import { validateArchive, validateRow, schemaFingerprint, TABLES } from "./backup-database.js";
import { scheduleSlot, BackupService } from "./backup-service.js";
import { DEFAULT_POLICY } from "./backup-types.js";
import { backupPath, atomicJson, requireDiskSpace } from "./backup-storage.js";
import { BackupController } from "./backup-controller.js";
import { AuthGuard, AuthService, digest } from "./auth.js";

let directory: string;
const password = "independent-backup-passphrase";
const manifest = () => ({ kind: "manifest", formatVersion: 1, schemaFingerprint, createdAt: new Date().toISOString(), applicationVersion: "0.1.0", sourceMasterKey: Buffer.alloc(32, 1).toString("base64") });
async function* records(values: unknown[]) { yield* values; }
async function collect(path: string, secret: string) { const values = []; for await (const value of readArchive(path, secret)) values.push(value); return values; }
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "netsentinel-backup-test-")); vi.stubEnv("NETSENTINEL_DATA_DIR", directory); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("encrypted streaming backup format", () => {
  it("round trips without exposing credentials or the source master key", async () => {
    const path = join(directory, "backup.nsbackup"); const data = [manifest(), { kind: "row", table: "Credential", data: { secret: "private-token" } }];
    await writeArchive(path, password, records(data));
    expect(await collect(path, password)).toEqual(data);
    const raw = await readFile(path);
    expect(raw.includes(Buffer.from("private-token"))).toBe(false);
    expect(raw.includes(Buffer.from(manifest().sourceMasterKey))).toBe(false);
    const second = join(directory, "second.nsbackup"); await writeArchive(second, password, records(data));
    expect(raw.equals(await readFile(second))).toBe(false);
  });
  it("rejects wrong passphrases, tampered content and truncated tags", async () => {
    const path = join(directory, "backup.nsbackup"); await writeArchive(path, password, records([manifest()]));
    await expect(collect(path, "wrong")).rejects.toThrow();
    const bytes = await readFile(path); bytes[45] = bytes[45]! ^ 1; await writeFile(path, bytes);
    await expect(collect(path, password)).rejects.toThrow();
    await writeFile(path, bytes.subarray(0, -10)); await expect(collect(path, password)).rejects.toThrow();
  });
  it("enforces input and decompression limits", async () => {
    const path = join(directory, "backup.nsbackup"); await writeArchive(path, password, records([{ text: "a".repeat(10000) }]));
    vi.stubEnv("NETSENTINEL_BACKUP_EXPANDED_MAX_BYTES", "100"); await expect(collect(path, password)).rejects.toThrow("BACKUP_EXPANDED_LIMIT");
    vi.stubEnv("NETSENTINEL_BACKUP_UPLOAD_MAX_BYTES", "10"); await expect(collect(path, password)).rejects.toThrow("BACKUP_FILE_INVALID");
  });
  it("rejects unknown entries, schema mismatch, path traversal and incomplete archives", async () => {
    for (const [index, data] of [
      [{ ...manifest(), schemaFingerprint: "other" }],
      [manifest(), { kind: "script", command: "DROP DATABASE" }],
      [manifest(), { kind: "avatar", key: "../bad.png", data: "AAAA" }],
      [manifest()],
    ].entries()) {
      const path = join(directory, `${index}.nsbackup`); await writeArchive(path, password, records(data));
      await expect(validateArchive(path, password, join(directory, `stage-${index}`))).rejects.toThrow();
    }
  });
  it("rejects forged typed rows and reserved internal settings", () => {
    expect(() => validateRow("Session", {})).toThrow("BACKUP_UNKNOWN_TABLE");
    expect(() => validateRow("Tag", { id: "t", name: "n", color: 5 })).toThrow("BACKUP_ROW_INVALID");
    expect(() => validateRow("Tag", { id: "t", name: "n", color: "blue", injected: true })).toThrow();
    expect(validateRow("Tag", { id: "t", name: "n", color: "blue" })).toEqual({ id: "t", name: "n", color: "blue" });
    expect(() => validateRow("Setting", { key: "_backupRestoreCheckpoint", value: "x", version: 1, updatedAt: new Date().toISOString() })).toThrow("BACKUP_RESERVED_SETTING");
  });
  it("keeps archive output private and enforces safe filenames", async () => {
    expect(() => backupPath("../../etc/passwd")).toThrow();
    await atomicJson(join(directory, "state.json"), { status: "ready" });
    expect(JSON.parse(await readFile(join(directory, "state.json"), "utf8"))).toEqual({ status: "ready" });
    await expect(requireDiskSpace(Number.MAX_SAFE_INTEGER, directory)).rejects.toThrow("BACKUP_DISK_FULL");
  });
});
describe("daily and weekly scheduling", () => {
  it("uses the selected timezone and a stable daily slot", () => {
    const policy = { ...DEFAULT_POLICY, timezone: "Asia/Shanghai" };
    expect(scheduleSlot(policy, new Date("2026-10-30T18:59:00Z"))).toBeNull();
    expect(scheduleSlot(policy, new Date("2026-10-30T19:00:00Z"))).toBe("2026-10-31");
    expect(scheduleSlot(policy, new Date("2026-10-31T05:00:00Z"))).toBe("2026-10-31");
    expect(scheduleSlot({ ...policy, frequency: "weekly", weekday: 0 }, new Date("2026-10-31T05:00:00Z"))).toBeNull();
    expect(scheduleSlot({ ...policy, frequency: "weekly", weekday: 6 }, new Date("2026-10-31T05:00:00Z"))).toBe("2026-10-31");
  });
});
describe("backup access contract", () => {
  it("enforces backup permissions and CSRF before invoking an endpoint", async () => {
    const user = { id: "user", email: "backup@example.com", displayName: "Admin", avatarKey: null, forcePasswordChange: false,
      roles: [{ role: { permissions: ["backup:manage"] } }] };
    const prisma = { session: { findUnique: vi.fn().mockResolvedValue({ idHash: "session", csrfHash: digest("csrf"), expiresAt: new Date(Date.now() + 60000), user }) } };
    const reflector = { getAllAndOverride: vi.fn((key: string) => key === "permissions" ? ["backup:manage"] : false) };
    const guard = new AuthGuard(reflector as never, prisma as never, new AuthService(prisma as never));
    const request = { originalUrl: "/api/v1/admin/backups", method: "POST", cookies: { netsentinel_session: "session" }, headers: {} as Record<string, string> };
    const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => request }) };
    await expect(guard.canActivate(context as never)).rejects.toThrow("Missing CSRF token");
    request.headers["x-csrf-token"] = "csrf";
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    user.roles[0]!.role.permissions = ["monitor:read"];
    await expect(guard.canActivate(context as never)).rejects.toThrow("Missing permission");
    prisma.session.findUnique.mockResolvedValue(null as never);
    await expect(guard.canActivate(context as never)).rejects.toThrow();
  });
  it("rejects API tokens even when they possess backup permission", () => {
    const service = { list: vi.fn() };
    const controller = new BackupController(service as never);
    expect(() => controller.list({ principal: { authentication: "token" } } as never)).toThrow("BACKUP_SESSION_REQUIRED");
    expect(service.list).not.toHaveBeenCalled();
  });
  it("validates confirmation and current account password before restore", async () => {
    const service = { verifyPassword: vi.fn(), restore: vi.fn() };
    const controller = new BackupController(service as never);
    const request = { principal: { authentication: "session", id: "admin" } };
    await expect(controller.restore(randomUUID(), { currentPassword: "x", confirmation: "no" }, request as never)).rejects.toThrow("BACKUP_INPUT_INVALID");
    expect(service.verifyPassword).not.toHaveBeenCalled();
    service.verifyPassword.mockRejectedValue(new Error("BACKUP_CURRENT_PASSWORD_INVALID"));
    await expect(controller.restore(randomUUID(), { currentPassword: "x", confirmation: "RESTORE" }, request as never)).rejects.toThrow("BACKUP_CURRENT_PASSWORD_INVALID");
    expect(service.restore).not.toHaveBeenCalled();
  });
  it("does not export sessions or instance-local backup configuration", () => {
    expect(TABLES).not.toContain("Session"); expect(TABLES).not.toContain("BackupPolicy");
  });
  it("does not expose wrapped archive passphrases in public metadata", () => {
    const service = new BackupService({} as never, {} as never, {} as never);
    const entry = { id: "one", name: "backup", archivePassword: { ciphertext: "secret" } };
    expect((service as unknown as { publicEntry(e: unknown): unknown }).publicEntry(entry)).toEqual({ id: "one", name: "backup" });
  });
});
