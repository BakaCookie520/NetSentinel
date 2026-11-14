import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { totpCode, verifyTotp } from "./combined/security.js";
import { createServer } from "node:http";

const serverModule = new URL("../dist/combined/server.js", import.meta.url).href;
let application: Awaited<ReturnType<(typeof import("./combined/server.js"))["createCombinedApplication"]>> | undefined;
let directory: string | undefined;
let base: string;
let cookie = "";
let csrf = "";
afterEach(async () => { await application?.close(); application = undefined; if (directory) await rm(directory, { force: true, recursive: true }); directory = undefined; vi.unstubAllEnvs(); cookie = ""; csrf = ""; });
async function start() {
  directory ??= await mkdtemp(join(tmpdir(), "netsentinel-setup-test-"));
  vi.stubEnv("NETSENTINEL_DATA_DIR", directory); vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("REDIS_HOST", ""); vi.stubEnv("REDIS_URL", ""); vi.stubEnv("NETSENTINEL_MASTER_KEY", ""); vi.stubEnv("WEB_ORIGIN", "");
  application = await (await import(serverModule)).createCombinedApplication();
  await new Promise<void>((resolve) => application!.server.listen(0, "127.0.0.1", resolve));
  const address = application!.server.address() as { port: number }; base = `http://127.0.0.1:${address.port}`;
}
async function call(path: string, body?: unknown, method = "POST", headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/api/v1${path}`, { method: body === undefined && method === "POST" ? "GET" : method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  return { response, payload };
}
async function unlock() {
  const token = await readFile(join(directory!, "setup.token"), "utf8");
  const result = await call("/setup/unlock", { token });
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200);
  cookie = result.response.headers.get("set-cookie")!.split(";")[0]!; csrf = result.payload.csrfToken;
}
async function install(enableTotp = false) {
  await unlock();
  let result = await call("/setup/database", { type: "sqlite" });
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200);
  result = await call("/setup/account", { email: "admin@test.local", displayName: "Owner", password: "Test-password-123!", confirmation: "Test-password-123!" });
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200);
  const security = await call("/setup/security", {});
  expect(security.response.status, JSON.stringify(security.payload)).toBe(200);
  result = await call("/setup/finish", { enableTotp, ...(enableTotp ? { code: totpCode(security.payload.secret) } : {}), recoverySaved: true });
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200);
  cookie = result.response.headers.get("set-cookie")!.split(";")[0]!; csrf = result.payload.csrfToken;
  return { ...security.payload, user: result.payload.user };
}
describe("combined SQLite installation", () => {
  it("persists monitoring tasks and executes probes without a Redis queue", async () => {
    const target = createServer((_request, response) => { response.writeHead(200); response.end("healthy"); });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    try {
      await start(); await install();
      expect((await call("/admin/settings", { settings: [{ key: "egressAllow", value: ["127.0.0.1"] }] }, "PUT")).response.status).toBe(200);
      const address = target.address() as { port: number };
      const created = await call("/monitors", { name: "local", type: "HTTP", target: `http://127.0.0.1:${address.port}/`, config: { method: "GET", headers: {}, expectedStatusMin: 200, expectedStatusMax: 299, verifyTls: true }, intervalSeconds: 60, timeoutMs: 1000, failureThreshold: 1, recoveryThreshold: 1, tagIds: [] });
      expect(created.response.status, JSON.stringify(created.payload)).toBe(201);
      const identifier = created.payload.id;
      const until = Date.now() + 10000;
      let monitor;
      do {
        monitor = await call(`/monitors/${identifier}`);
        if (monitor.payload.lastCheckedAt) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < until);
      expect(monitor?.payload.status, JSON.stringify(monitor?.payload)).toBe("UP");
      expect(monitor?.payload.results[0].ok).toBe(true);
      expect((await call("/dashboard")).payload.probeResults24h).toBeGreaterThanOrEqual(1);
      expect((await call("/logs?source=PROBE&status=SUCCESS")).payload.items.length).toBeGreaterThanOrEqual(1);
    } finally { await new Promise<void>((resolve) => target.close(() => resolve())); }
  }, 30000);
  it("starts without PostgreSQL/Redis, protects setup and persists the complete installation", async () => {
    await start();
    expect((await call("/setup/status")).payload.initialized).toBe(false);
    expect((await call("/monitors")).response.status).toBe(400);
    expect((await call("/setup/unlock", { token: "wrong" })).response.status).toBe(401);
    await unlock();
    expect((await call("/setup/database", { type: "sqlite" }, "POST", { origin: "https://evil.invalid" })).response.status).toBe(403);
    const secret = await install();
    expect(secret.recoveryKey).toHaveLength(43);
    expect(secret.user.permissions).toContain("backup:manage");
    expect((await call("/setup/account", {})).response.status).toBe(409);
    expect((await call("/health/ready")).payload.workerConnected).toBe(true);
    expect((await call("/monitors")).payload).toEqual([]);
    await application!.close(); application = undefined;
    await start();
    expect((await call("/setup/status")).payload.initialized).toBe(true);
    const login = await call("/auth/login", { email: "admin@test.local", password: "Test-password-123!" });
    expect(login.response.status, JSON.stringify(login.payload)).toBe(200);
    expect(login.payload.user.id).toBe(secret.user.id);
  }, 30000);
  it("requires TOTP or an unused backup code before creating sessions", async () => {
    await start(); const security = await install(true);
    cookie = ""; csrf = "";
    const login = await call("/auth/login", { email: "admin@test.local", password: "Test-password-123!" });
    expect(login.payload.requiresTwoFactor).toBe(true);
    expect(login.response.headers.get("set-cookie")).toBeNull();
    const wrong = await call("/auth/two-factor", { challengeId: login.payload.challengeId, code: "000000" });
    expect(wrong.response.status).toBe(403);
    const replay = await call("/auth/two-factor", { challengeId: login.payload.challengeId, code: totpCode(security.secret) });
    expect(replay.response.status).toBe(403);
    const backup = await call("/auth/two-factor", { challengeId: login.payload.challengeId, code: security.backupCodes[0] });
    expect(backup.response.status, JSON.stringify(backup.payload)).toBe(200);
    const second = await call("/auth/login", { email: "admin@test.local", password: "Test-password-123!" });
    expect((await call("/auth/two-factor", { challengeId: second.payload.challengeId, code: security.backupCodes[0] })).response.status).toBe(403);
  }, 30000);
  it("recovers a password only after acknowledging the replacement key, revoking sessions and tokens", async () => {
    await start(); const security = await install();
    const token = await call("/tokens", { name: "automation", scopes: ["monitor:read"] });
    expect(token.response.status, JSON.stringify(token.payload)).toBe(200);
    const pending = await call("/auth/recover", { email: "admin@test.local", recoveryKey: security.recoveryKey, password: "Replacement-pass-123!", confirmation: "Replacement-pass-123!" });
    expect(pending.response.status, JSON.stringify(pending.payload)).toBe(200);
    expect((await call("/auth/me")).response.status).toBe(200);
    expect((await call("/auth/recover/confirm", { recoveryToken: pending.payload.recoveryToken, saved: false })).response.status).toBe(400);
    expect((await call("/auth/recover/confirm", { recoveryToken: pending.payload.recoveryToken, saved: true })).response.status).toBe(200);
    expect((await call("/auth/me")).response.status).toBe(401);
    cookie = ""; csrf = "";
    expect((await call("/monitors", undefined, "GET", { authorization: `Bearer ${token.payload.token}` })).response.status).toBe(401);
    expect((await call("/auth/login", { email: "admin@test.local", password: "Replacement-pass-123!" })).response.status).toBe(200);
    expect((await call("/auth/recover", { email: "admin@test.local", recoveryKey: security.recoveryKey, password: "Another-password-123!", confirmation: "Another-password-123!" })).response.status).toBe(401);
  }, 30000);
  it("preserves first-step progress across restart and refuses duplicate application owners", async () => {
    await start(); await unlock();
    expect((await call("/setup/database", { type: "sqlite" })).response.status).toBe(200);
    expect((await call("/setup/account", { email: "admin@test.local", displayName: "Owner", password: "Test-password-123!", confirmation: "Test-password-123!" })).response.status).toBe(200);
    await expect((await import(serverModule)).createCombinedApplication()).rejects.toThrow("INSTANCE_ALREADY_ACTIVE");
    await application!.close(); application = undefined; await start();
    expect((await call("/setup/status")).payload.step).toBe(2); await unlock();
    const first = await call("/setup/security", {}); const second = await call("/setup/security", {});
    expect(first.payload.recoveryKey).not.toBe(second.payload.recoveryKey);
    expect((await call("/setup/finish", { enableTotp: false, recoverySaved: false })).response.status).toBe(400);
  }, 30000);
});
describe("TOTP RFC 6238", () => {
  it("matches the six-digit RFC test vector and rejects replay", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpCode(secret, 1)).toBe("287082");
    expect(verifyTotp(secret, "287082", -1, 59000)).toBe(1);
    expect(verifyTotp(secret, "287082", 1, 59000)).toBeNull();
  });
});
