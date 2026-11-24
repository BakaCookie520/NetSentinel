import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { passwordHash, totpCode, verifyTotp } from "./combined/security.js";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { startSmtpCapture } from "./smtp-capture.test-support.js";

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
async function install(enableTotp = false, database: unknown = { type: "sqlite" }, username = "owner") {
  await unlock();
  let result = await call("/setup/database", database);
  expect(result.response.status, JSON.stringify(result.payload)).toBe(200);
  result = await call("/setup/account", { username, password: "Test-password-123!", confirmation: "Test-password-123!" });
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
    const login = await call("/auth/login", { identifier: "owner", password: "Test-password-123!" });
    expect(login.response.status, JSON.stringify(login.payload)).toBe(200);
    expect(login.payload.user.id).toBe(secret.user.id);
  }, 30000);
  it("requires TOTP or an unused backup code before creating sessions", async () => {
    await start(); const security = await install(true);
    cookie = ""; csrf = "";
    const login = await call("/auth/login", { identifier: "owner", password: "Test-password-123!" });
    expect(login.payload.requiresTwoFactor).toBe(true);
    expect(login.response.headers.get("set-cookie")).toBeNull();
    const wrong = await call("/auth/two-factor", { challengeId: login.payload.challengeId, code: "000000" });
    expect(wrong.response.status).toBe(403);
    const replay = await call("/auth/two-factor", { challengeId: login.payload.challengeId, code: totpCode(security.secret) });
    expect(replay.response.status).toBe(403);
    const backup = await call("/auth/two-factor", { challengeId: login.payload.challengeId, code: security.backupCodes[0] });
    expect(backup.response.status, JSON.stringify(backup.payload)).toBe(200);
    const second = await call("/auth/login", { identifier: "owner", password: "Test-password-123!" });
    expect((await call("/auth/two-factor", { challengeId: second.payload.challengeId, code: security.backupCodes[0] })).response.status).toBe(403);
  }, 30000);
  it("recovers a password only after acknowledging the replacement key, revoking sessions and tokens", async () => {
    await start(); const security = await install();
    const token = await call("/tokens", { name: "automation", scopes: ["monitor:read"] });
    expect(token.response.status, JSON.stringify(token.payload)).toBe(200);
    const pending = await call("/auth/recover", { identifier: "owner", recoveryKey: security.recoveryKey, password: "Replacement-pass-123!", confirmation: "Replacement-pass-123!" });
    expect(pending.response.status, JSON.stringify(pending.payload)).toBe(200);
    expect((await call("/auth/me")).response.status).toBe(200);
    expect((await call("/auth/recover/confirm", { recoveryToken: pending.payload.recoveryToken, saved: false })).response.status).toBe(400);
    expect((await call("/auth/recover/confirm", { recoveryToken: pending.payload.recoveryToken, saved: true })).response.status).toBe(200);
    expect((await call("/auth/me")).response.status).toBe(401);
    cookie = ""; csrf = "";
    expect((await call("/monitors", undefined, "GET", { authorization: `Bearer ${token.payload.token}` })).response.status).toBe(401);
    expect((await call("/auth/login", { identifier: "owner", password: "Replacement-pass-123!" })).response.status).toBe(200);
    expect((await call("/auth/recover", { identifier: "owner", recoveryKey: security.recoveryKey, password: "Another-password-123!", confirmation: "Another-password-123!" })).response.status).toBe(401);
  }, 30000);
  it("preserves first-step progress across restart and refuses duplicate application owners", async () => {
    await start(); await unlock();
    expect((await call("/setup/database", { type: "sqlite" })).response.status).toBe(200);
    expect((await call("/setup/account", { username: "owner", displayName: "Owner", password: "Test-password-123!", confirmation: "Test-password-123!" })).response.status).toBe(200);
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

const mailBackends = [{ name: "sqlite", config: () => ({ type: "sqlite" }) }];
if (process.env.ONBOARDING_POSTGRES_URL?.includes("test")) {
  mailBackends.push({ name: "postgresql", config: () => {
    const url = new URL(process.env.ONBOARDING_POSTGRES_URL!); url.searchParams.set("schema", `mail_${randomUUID().replaceAll("-", "")}`);
    return { type: "postgresql", url: url.toString() };
  } });
}
if (process.env.ONBOARDING_REDIS_URL) mailBackends.push({ name: "redis", config: () => ({ type: "redis", url: process.env.ONBOARDING_REDIS_URL, namespace: `mail_${randomUUID().replaceAll("-", "")}` }) });

for (const backend of mailBackends) it(`installs without email and delivers account and workflow mail on ${backend.name}`, async () => {
  await start(); const password = "Test-password-123!"; const replacement = "Replaced-password-123!"; const email = "owner@example.test";
  const security = await install(true, backend.config(), "Owner.Admin");
  expect(security.user).toMatchObject({ username: "owner.admin", email: null, emailVerified: false, displayName: "owner.admin" });
  const current = () => ({ cookie, csrf });
  const auth = { cookie: "", "x-csrf-token": "" };
  const signIn = (identifier: string, password: string) => call("/auth/login", { identifier, password }, "POST", auth);
  expect((await signIn("OWNER.ADMIN", password)).payload.requiresTwoFactor).toBe(true);
  expect((await signIn(email, password)).response.status).toBe(401);
  const smtp = await startSmtpCapture(directory!);
  const configuration = { enabled: true, host: "127.0.0.1", port: smtp.port, tls: "implicit", user: "smtp-account", password: "smtp-isolated-secret", from: "netsentinel@example.test" };
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 10000;
    while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(predicate()).toBe(true);
  };
  try {
    expect((await call("/admin/settings", { settings: [{ key: "egressAllow", value: ["127.0.0.1"] }] }, "PUT")).response.status).toBe(200);
    const saved = await call("/admin/mail", configuration, "PUT");
    expect(saved.response.status, JSON.stringify(saved.payload)).toBe(200);
    expect(saved.payload).toMatchObject({ enabled: true, passwordConfigured: true }); expect(saved.payload).not.toHaveProperty("password");
    expect((await call("/admin/mail")).payload).not.toHaveProperty("password");
    const internal = await application!.state.store!.get("Setting", "__mailService");
    expect(JSON.stringify(internal)).not.toContain(configuration.password);
    expect(JSON.stringify((await call("/admin/settings")).payload)).not.toContain("__mailService");
    const { password: _secret, ...safe } = configuration;
    const test = await call("/admin/mail/test", { ...safe, to: email });
    expect(test.response.status, JSON.stringify(test.payload)).toBe(200);
    expect(smtp.messages[0]?.to).toContain(email);
    const verify = await call("/auth/me/email/request", { email, currentPassword: password });
    expect(verify.response.status, JSON.stringify(verify.payload)).toBe(200);
    const code = smtp.messages.at(-1)?.text.match(/: (\d{6})/u)?.[1]; expect(code).toBeDefined();
    expect((await call("/auth/me/email")).payload.email).toBeNull();
    expect((await call("/auth/me/email/confirm", { email, code: code === "000000" ? "111111" : "000000", currentPassword: password })).response.status).toBe(400);
    expect((await call("/auth/me/email/confirm", { email, code, currentPassword: password })).response.status).toBe(200);
    expect((await call("/auth/me/email")).payload).toMatchObject({ verified: true, email });
    expect((await signIn(email.toUpperCase(), password)).payload.requiresTwoFactor).toBe(true);
    const workflow = async (config: Record<string, unknown>, credentialId?: string) => {
      const created = await call("/workflows", { name: String(config.subject), trigger: "MANUAL", approvalMode: "AUTO", steps: [{ name: "Deliver", type: "EMAIL", credentialId, config }] });
      expect(created.response.status, JSON.stringify(created.payload)).toBe(201);
      const execute = await call(`/workflows/${created.payload.id}/execute`, {});
      expect(execute.response.ok, JSON.stringify(execute.payload)).toBe(true);
      let run = execute.payload;
      const deadline = Date.now() + 8000;
      while (!["SUCCEEDED", "FAILED", "UNKNOWN"].includes(run.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const result = await call(`/workflows/runs/${execute.payload.id}`);
        if (result.response.status === 503 && result.payload.detail === "STORAGE_RECOVERY_REQUIRED") continue;
        expect(result.response.ok, JSON.stringify(result.payload)).toBe(true);
        run = result.payload;
      }
      return run;
    };
    const system = await workflow({ transport: "system", to: email, subject: "system transport", body: "system workflow" });
    expect(system.status, JSON.stringify(system)).toBe("SUCCEEDED");
    const credential = await call("/credentials", { name: "Dedicated SMTP", type: "SMTP", host: configuration.host, port: configuration.port, secure: true, user: configuration.user, password: configuration.password, from: configuration.from });
    expect(credential.response.status, JSON.stringify(credential.payload)).toBe(201);
    const standalone = await workflow({ to: email, subject: "dedicated transport", body: "dedicated workflow" }, credential.payload.id);
    expect(standalone.status, JSON.stringify(standalone)).toBe("SUCCEEDED");
    expect(smtp.messages.some((message) => message.text.includes("dedicated workflow"))).toBe(true);
    expect(smtp.messages.some((message) => message.text.includes("system workflow"))).toBe(true);
    const token = await call("/tokens", { name: "automation", scopes: ["monitor:read"] });
    expect(token.response.ok).toBe(true);
    const oldChallenge = (await signIn(email, password)).payload.challengeId;
    const oldSession = current();
    const unrecognized = await call("/auth/recover/email/request", { email: "unknown@example.test" }, "POST", auth);
    const requested = await call("/auth/recover/email/request", { email }, "POST", auth);
    expect([requested.response.status, requested.payload]).toEqual([unrecognized.response.status, unrecognized.payload]);
    await until(() => smtp.messages.some((item) => /[a-zA-Z0-9_-]{32}/u.test(item.text)));
    const reset = smtp.messages.at(-1)?.text.match(/: ([a-zA-Z0-9_-]{32})/u)?.[1]; expect(reset).toBeDefined();
    const data = { email, code: reset, password: replacement, confirmation: replacement };
    expect((await call("/auth/recover/email/confirm", data, "POST", auth)).response.status).toBe(200);
    expect((await call("/auth/recover/email/confirm", data, "POST", auth)).response.status).toBe(400);
    expect((await call("/auth/two-factor", { challengeId: oldChallenge, code: security.backupCodes[1] }, "POST", auth)).response.status).toBe(401);
    expect((await call("/auth/me", undefined, "GET", { cookie: oldSession.cookie })).response.status).toBe(401);
    expect((await call("/monitors", undefined, "GET", { ...auth, authorization: `Bearer ${token.payload.token}` })).response.status).toBe(401);
    expect((await signIn(email, password)).response.status).toBe(401);
    const newChallenge = (await signIn("owner.admin", replacement)).payload.challengeId;
    const login = await call("/auth/two-factor", { challengeId: newChallenge, code: security.backupCodes[0] }, "POST", auth);
    expect(login.response.ok).toBe(true);
    cookie = login.response.headers.get("set-cookie")!.split(";")[0]!; csrf = login.payload.csrfToken;
    expect((await call("/admin/mail", { ...safe, enabled: false }, "PUT")).response.status).toBe(200);
    const disabled = await workflow({ transport: "system", to: email, subject: "system SMTP disabled", body: "do not send" });
    expect(disabled.status).toBe("FAILED");
    expect((await signIn(email, replacement)).payload.requiresTwoFactor).toBe(true);
    expect((await call("/auth/me/email", { currentPassword: replacement }, "DELETE")).response.status).toBe(200);
    expect((await signIn(email, replacement)).response.status).toBe(401);
    expect((await signIn("owner.admin", replacement)).payload.requiresTwoFactor).toBe(true);
  } finally { await smtp.close(); }
}, 120000);
for (const backend of mailBackends) it(`preserves a legacy email login and assigns an account name on ${backend.name}`, async () => {
  await start(); await install(false, backend.config());
  const password = "Legacy-password-123!";
  const email = "legacy@example.test";
  const encoded = await passwordHash(password);
  const legacy = await application!.state.store!.transaction((tx) => tx.put("User", { email, passwordHash: encoded, displayName: "Migrated admin" }));
  expect(legacy.username).toBeNull();
  await application!.close(); application = undefined;
  cookie = ""; csrf = "";
  await start();
  const signIn = await call("/auth/login", { email, password });
  expect(signIn.response.ok, JSON.stringify(signIn.payload)).toBe(true);
  expect(signIn.payload.user).toMatchObject({ email, emailVerified: false, username: expect.stringMatching(/^legacy-/u) });
  expect((await call("/auth/login", { identifier: signIn.payload.user.username, password })).payload.user.id).toBe(legacy.id);
}, 60000);

it("upgrades a v1 SQLite user table without losing role links or requiring an email for new users", async () => {
  await start(); const security = await install();
  const oldEmail = "old-owner@example.test";
  await application!.state.store!.transaction(async (tx) => {
    const owner = (await tx.get("User", security.user.id))!;
    await tx.put("User", { ...owner, email: oldEmail });
  });
  await application!.close(); application = undefined;
  const db = new DatabaseSync(join(directory!, "database", "netsentinel.sqlite"));
  try {
    db.exec(`PRAGMA foreign_keys=OFF; BEGIN;
      CREATE TABLE User_v1 (_key TEXT PRIMARY KEY,id TEXT NOT NULL UNIQUE,email TEXT NOT NULL UNIQUE,displayName TEXT NOT NULL,avatarKey TEXT,passwordHash TEXT NOT NULL,locale TEXT NOT NULL,timezone TEXT NOT NULL,forcePasswordChange INTEGER NOT NULL,version INTEGER NOT NULL,disabledAt TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      INSERT INTO User_v1 SELECT _key,id,email,displayName,avatarKey,passwordHash,locale,timezone,forcePasswordChange,version,disabledAt,createdAt,updatedAt FROM User;
      DROP TABLE User; ALTER TABLE User_v1 RENAME TO User; PRAGMA user_version=1; COMMIT;`);
  } finally { db.close(); }
  cookie = ""; csrf = ""; await start();
  const login = await call("/auth/login", { email: oldEmail, password: "Test-password-123!" });
  expect(login.response.ok, JSON.stringify(login.payload)).toBe(true);
  expect(login.payload.user.permissions).toContain("user:manage");
  expect(login.payload.user).toMatchObject({ id: security.user.id, email: oldEmail, emailVerified: false, username: expect.stringMatching(/^legacy-/u) });
  cookie = login.response.headers.get("set-cookie")!.split(";")[0]!; csrf = login.payload.csrfToken;
  const newUser = await call("/admin/users", { username: "new-user", displayName: "New user", password: "Another-password-123!", roleIds: [] });
  expect(newUser.response.status, JSON.stringify(newUser.payload)).toBe(201);
  expect(newUser.payload).toMatchObject({ username: "new-user", email: null });
}, 30000);
