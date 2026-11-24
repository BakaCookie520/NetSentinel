import type { Express } from "express";
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { sendSmtp } from "@netsentinel/worker/execution";
import { emailSchema, findAccount, usernameSchema } from "./account-name.js";
import { encodeMail, mailFields, mailView, MAIL_SETTING, mergeMail, readMail, smtpOptions } from "./mail-config.js";
import { digest, passwordHash, passwordMatches } from "./security.js";
import { requirePermission, type UserRequest } from "./auth-routes.js";
import type { ApplicationState } from "./setup.js";
import type { UnitOfWork } from "../storage/store.js";

const passwordField = z.string().min(1).max(1024);
const expiry = 10 * 60_000;
const cooldown = 60_000;
const byUser = (userId: string) => [{ field: "userId", op: "eq" as const, value: userId }];
async function revokeCredentials(tx: UnitOfWork, userId: string) {
  for (const session of await tx.list("Session", { filters: byUser(userId) })) await tx.remove("Session", session.idHash);
  for (const token of await tx.list("ApiToken", { filters: byUser(userId) })) if (!token.revokedAt) await tx.put("ApiToken", { ...token, revokedAt: new Date().toISOString() });
}

export function accountMail(app: Express, state: ApplicationState) {
  const store = () => { if (!state.store || !state.config.state.initialized) throw new Error("SETUP_REQUIRED"); return state.store; };
  const key = () => state.config.key;
  const binding = new Map<string, { email: string; hash: string; passwordHash: string; session: string; version: number; until: number; tries: number }>();
  const bindingRequests = new Map<string, number>();
  const resetRequests = new Map<string, number>();
  const resets = new Map<string, { id: string; email: string; passwordHash: string; version: number; checkpoint: unknown; until: number }>();
  const sweep = () => {
    const now = Date.now();
    for (const [id, entry] of binding) if (entry.until <= now) binding.delete(id);
    for (const [id, entry] of resets) if (entry.until <= now) resets.delete(id);
    for (const map of [bindingRequests, resetRequests]) for (const [id, until] of map) if (until <= now) map.delete(id);
  };
  const send = async (to: string, subject: string, text: string, draft?: ReturnType<typeof mergeMail>) => {
    const config = draft ?? await readMail(store(), key());
    const runtime = state.runtime;
    if ((!config?.enabled && !draft) || !config || !runtime) throw new Error("MAIL_DISABLED");
    await sendSmtp(smtpOptions(config), { to, subject, text }, runtime.authorize.bind(runtime), 10_000);
  };
  const withPassword = async (request: UserRequest, currentPassword: string) => {
    if (request.principal.authentication !== "session" || !request.sessionHash) throw new Error("AUTH_SESSION_REQUIRED");
    const user = await store().get("User", request.principal.id);
    if (!user || user.disabledAt || !await passwordMatches(user.passwordHash, currentPassword)) throw new Error("AUTH_INVALID");
    return user;
  };
  return {
    publicRoutes() {
      app.post("/api/v1/auth/recover/email/request", (request, response) => {
        const { email } = z.object({ email: emailSchema }).parse(request.body);
        sweep(); response.status(202).json({ ok: true });
        const address = digest(email);
        if (resetRequests.has(address) || resetRequests.size >= 1000 || resets.size >= 1000) return;
        resetRequests.set(address, Date.now() + cooldown);
        void (async () => {
          const database = store();
          const checkpoint = (await database.get("Setting", "__restoreCheckpoint"))?.value;
          const user = await findAccount(database, { email });
          if (!user || user.disabledAt || !user.emailVerified) return;
          const code = randomBytes(24).toString("base64url"); const hash = digest(code);
          for (const [id, entry] of resets) if (entry.id === user.id) resets.delete(id);
          resets.set(hash, { id: user.id, email, passwordHash: user.passwordHash, version: user.version, checkpoint, until: Date.now() + expiry });
          try { await send(email, "NetSentinel password reset / 重置密码", `Reset code / 重置验证码: ${code}\nExpires in 10 minutes. If you did not request this, ignore this message.`); }
          catch { resets.delete(hash); }
        })().catch(() => undefined);
      });
      app.post("/api/v1/auth/recover/email/confirm", async (request, response) => {
        const input = z.object({ email: emailSchema, code: z.string().trim().min(32).max(128), password: z.string().min(12).max(1024), confirmation: z.string().max(1024) }).parse(request.body);
        if (input.password !== input.confirmation) throw new Error("PASSWORD_MISMATCH");
        sweep(); const hash = digest(input.code); const pending = resets.get(hash);
        if (!pending || pending.email !== input.email) throw new Error("MAIL_CODE_INVALID");
        resets.delete(hash);
        const encoded = await passwordHash(input.password);
        await store().transaction(async (tx) => {
          const user = await tx.get("User", pending.id);
          if ((await tx.get("Setting", "__restoreCheckpoint"))?.value !== pending.checkpoint) throw new Error("MAIL_CODE_INVALID");
          if (!user || user.disabledAt || !user.emailVerified || user.email !== pending.email || user.version !== pending.version || user.passwordHash !== pending.passwordHash) throw new Error("MAIL_CODE_INVALID");
          await tx.put("User", { ...user, passwordHash: encoded, forcePasswordChange: false }, user.version);
          await revokeCredentials(tx, user.id);
          await tx.put("AuditEvent", { actorId: user.id, action: "account.recover.email", resourceType: "user", resourceId: user.id });
        });
        response.json({ ok: true });
      });
    },
    privateRoutes() {
      const adminPath = "/api/v1/admin/mail";
      app.use(adminPath, requirePermission("settings:manage"), (request, _response, next) => next((request as UserRequest).principal.authentication === "session" ? undefined : new Error("AUTH_SESSION_REQUIRED")));
      app.get(adminPath, async (_request, response) => response.json(mailView(await readMail(store(), key()))));
      app.put(adminPath, async (request, response) => {
        const input = mailFields.parse(request.body);
        const result = await store().transaction(async (tx) => {
          const config = mergeMail(input, await readMail(tx, key()));
          const previous = await tx.get("Setting", MAIL_SETTING);
          await tx.put("Setting", { ...previous, key: MAIL_SETTING, value: encodeMail(config, key()) }, previous?.version);
          await tx.put("AuditEvent", { actorId: (request as UserRequest).principal.id, action: "mail.settings.update", resourceType: "setting", resourceId: MAIL_SETTING });
          return mailView(config);
        });
        response.json(result);
      });
      app.post(`${adminPath}/test`, async (request, response) => {
        const input = mailFields.extend({ to: emailSchema }).parse(request.body);
        const { to, ...config } = input;
        await send(to, "NetSentinel SMTP test / 测试邮件", "This message confirms SMTP delivery from NetSentinel.", mergeMail(config, await readMail(store(), key())));
        response.json({ ok: true });
      });
      const path = "/api/v1/auth/me/email";
      app.get(path, async (request, response) => {
        const principal = (request as UserRequest).principal;
        if (principal.authentication !== "session") throw new Error("AUTH_SESSION_REQUIRED");
        response.json({ username: principal.username, email: principal.email, verified: principal.emailVerified, mailEnabled: Boolean((await readMail(store(), key()))?.enabled) });
      });
      app.post(`${path}/request`, async (request, response) => {
        const { email, currentPassword } = z.object({ email: emailSchema, currentPassword: passwordField }).parse(request.body);
        const req = request as UserRequest;
        const user = await withPassword(req, currentPassword);
        sweep();
        if (bindingRequests.has(user.id)) throw new Error("MAIL_RATE_LIMIT");
        const other = await findAccount(store(), { email });
        if (other && other.id !== user.id) throw new Error("MAIL_ADDRESS_IN_USE");
        if (bindingRequests.has(user.id)) throw new Error("MAIL_RATE_LIMIT");
        bindingRequests.set(user.id, Date.now() + cooldown);
        const code = String(randomInt(1_000_000)).padStart(6, "0");
        const pending = { email, hash: digest(code), passwordHash: user.passwordHash, session: req.sessionHash!, version: user.version, until: Date.now() + expiry, tries: 0 };
        binding.set(user.id, pending);
        try { await send(email, "NetSentinel email verification / 验证邮箱", `Verification code / 邮箱验证码: ${code}\nExpires in 10 minutes.`); }
        catch (error) { if (binding.get(user.id) === pending) binding.delete(user.id); throw error; }
        response.json({ ok: true });
      });
      app.post(`${path}/confirm`, async (request, response) => {
        const { currentPassword, code, email } = z.object({ currentPassword: passwordField, code: z.string().trim().regex(/^\d{6}$/u), email: emailSchema }).parse(request.body);
        const req = request as UserRequest; const user = await withPassword(req, currentPassword);
        sweep(); const pending = binding.get(user.id);
        if (!pending || pending.session !== req.sessionHash || pending.email !== email || user.passwordHash !== pending.passwordHash || user.version !== pending.version) throw new Error("MAIL_CODE_INVALID");
        const valid = pending.hash === digest(code);
        if (++pending.tries >= 5 || valid) binding.delete(user.id);
        if (!valid) throw new Error("MAIL_CODE_INVALID");
        await store().transaction(async (tx) => {
          await tx.put("User", { ...user, email, emailVerified: true }, user.version);
          await tx.put("AuditEvent", { actorId: user.id, action: "account.email.verify", resourceType: "user", resourceId: user.id });
        });
        response.json({ ok: true });
      });
      app.delete(path, async (request, response) => {
        const { currentPassword } = z.object({ currentPassword: passwordField }).parse(request.body);
        const user = await withPassword(request as UserRequest, currentPassword);
        if (!user.username) throw new Error("ACCOUNT_NAME_REQUIRED");
        binding.delete(user.id);
        await store().transaction(async (tx) => {
          await tx.put("User", { ...user, email: null, emailVerified: false }, user.version);
          await tx.put("AuditEvent", { actorId: user.id, action: "account.email.remove", resourceType: "user", resourceId: user.id });
        });
        response.json({ ok: true });
      });
      app.put("/api/v1/auth/me/username", async (request, response) => {
        const { currentPassword, username } = z.object({ currentPassword: passwordField, username: usernameSchema }).parse(request.body);
        const user = await withPassword(request as UserRequest, currentPassword);
        await store().transaction((tx) => tx.put("User", { ...user, username }, user.version));
        response.json({ ok: true });
      });
    },
  };
}
