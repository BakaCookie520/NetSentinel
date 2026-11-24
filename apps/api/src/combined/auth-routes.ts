import type { Express, Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { digest, passwordHash, passwordMatches, issueSession, identity, verifySecondFactor, totpSecret, newRecovery, newBackupCodes, encryptTotp, verifyTotp, type Identity } from "./security.js";
import { cookie, type ApplicationState } from "./setup.js";
import { accountMail } from "./account-mail.js";
import QRCode from "qrcode";
import { findAccount, hasIdentifier, loginFields } from "./account-name.js";

export type UserRequest = Request & { principal: Identity; sessionHash?: string };
export const requirePermission = (permission: string) => (request: Request, _response: Response, next: NextFunction) => {
  if (!(request as UserRequest).principal?.permissions.includes(permission)) { next(new Error("AUTH_FORBIDDEN")); return; }
  next();
};
export function mountAuth(app: Express, state: ApplicationState) {
  const challenges = new Map<string, { userId: string; passwordHash: string; expires: number; tries: number }>();
  const inFlightChallenges = new Set<string>();
  const enrollments = new Map<string, { secret: string; expires: number }>();
  const recoveries = new Map<string, { userId: string; newHash: string; previousHash: string; previousPasswordHash: string; recovery: ReturnType<typeof newRecovery>; expires: number }>();
  app.use("/api/v1/auth", (_request, _response, next) => {
    const now = Date.now();
    for (const [key, value] of challenges) if (value.expires < now) challenges.delete(key);
    for (const [key, value] of enrollments) if (value.expires < now) enrollments.delete(key);
    for (const [key, value] of recoveries) if (value.expires < now) recoveries.delete(key);
    next();
  });
  const store = () => { if (!state.store || !state.config.state.initialized) throw new Error("SETUP_REQUIRED"); return state.store; };
  const verifyPassword = async (request: UserRequest, body: unknown) => {
    if (request.principal.authentication !== "session") throw new Error("AUTH_SESSION_REQUIRED");
    const input = z.object({ currentPassword: z.string().min(1).max(1024) }).parse(body);
    const user = await store().get("User", request.principal.id);
    if (!user || !await passwordMatches(user.passwordHash, input.currentPassword)) throw new Error("AUTH_INVALID");
    return user;
  };
  app.post("/api/v1/auth/login", async (request, response) => {
    const input = z.object({ ...loginFields, password: z.string().min(1).max(1024) }).refine(hasIdentifier).parse(request.body);
    const user = await findAccount(store(), input);
    if (!user || user.disabledAt || !await passwordMatches(user.passwordHash, input.password)) throw new Error("AUTH_INVALID");
    if ((await store().get("AccountSecurity", user.id))?.totpEncrypted) {
      const challengeId = randomBytes(32).toString("base64url");
      challenges.set(digest(challengeId), { userId: user.id, passwordHash: user.passwordHash, expires: Date.now() + 300000, tries: 0 });
      response.json({ requiresTwoFactor: true, challengeId }); return;
    }
    const session = await issueSession(store(), user.id, user.passwordHash); cookie(response, session.raw);
    response.json({ user: session.user, csrfToken: session.csrfToken });
  });
  app.post("/api/v1/auth/two-factor", async (request, response) => {
    const input = z.object({ challengeId: z.string().max(256), code: z.string().max(128) }).parse(request.body);
    const challengeKey = digest(input.challengeId);
    const challenge = challenges.get(challengeKey);
    if (!challenge || inFlightChallenges.has(challengeKey) || challenge.expires < Date.now() || ++challenge.tries > 5) throw new Error("AUTH_INVALID");
    inFlightChallenges.add(challengeKey);
    try {
      await store().transaction(async (tx) => {
        const user = await tx.get("User", challenge.userId);
        if (!user || user.disabledAt || user.passwordHash !== challenge.passwordHash) throw new Error("AUTH_INVALID");
        await verifySecondFactor(tx, challenge.userId, input.code, state.config.key);
      });
      challenges.delete(challengeKey);
    } finally { inFlightChallenges.delete(challengeKey); }
    const session = await issueSession(store(), challenge.userId, challenge.passwordHash); cookie(response, session.raw);
    response.json({ user: session.user, csrfToken: session.csrfToken });
  });
  app.post("/api/v1/auth/recover", async (request, response) => {
    const input = z.object({ ...loginFields, recoveryKey: z.string().min(20).max(256), password: z.string().min(12).max(1024), confirmation: z.string() }).refine(hasIdentifier).parse(request.body);
    if (input.password !== input.confirmation) throw new Error("PASSWORD_MISMATCH");
    const user = await findAccount(store(), input);
    const security = user ? await store().get("AccountSecurity", user.id) : null;
    if (!user || user.disabledAt || !security?.recoveryHash || security.recoveryHash !== digest(input.recoveryKey)) throw new Error("AUTH_INVALID");
    const token = randomBytes(32).toString("base64url"); const recovery = newRecovery();
    recoveries.set(digest(token), { userId: user.id, newHash: await passwordHash(input.password), previousHash: security.recoveryHash, previousPasswordHash: user.passwordHash, recovery, expires: Date.now() + 300000 });
    response.json({ recoveryToken: token, recoveryKey: recovery.key });
  });
  app.post("/api/v1/auth/recover/confirm", async (request, response) => {
    const input = z.object({ recoveryToken: z.string().max(256), saved: z.literal(true) }).parse(request.body);
    const pending = recoveries.get(digest(input.recoveryToken));
    if (!pending || pending.expires < Date.now()) throw new Error("AUTH_INVALID");
    await store().transaction(async (tx) => {
      const security = await tx.get("AccountSecurity", pending.userId); const user = await tx.get("User", pending.userId);
      if (!security || !user || user.disabledAt || security.recoveryHash !== pending.previousHash || user.passwordHash !== pending.previousPasswordHash) throw new Error("AUTH_INVALID");
      await tx.put("User", { ...user, passwordHash: pending.newHash, forcePasswordChange: false }, user.version);
      await tx.put("AccountSecurity", { ...security, recoveryHash: pending.recovery.hash, backupHashes: [], totpEncrypted: null, totpLastCounter: -1 }, security.version);
      for (const session of await tx.list("Session", { filters: [{ field: "userId", op: "eq", value: user.id }] })) await tx.remove("Session", session.idHash);
      for (const token of await tx.list("ApiToken", { filters: [{ field: "userId", op: "eq", value: user.id }] })) await tx.put("ApiToken", { ...token, revokedAt: new Date().toISOString() });
      await tx.put("AuditEvent", { actorId: user.id, action: "account.recover", resourceType: "user", resourceId: user.id });
    });
    recoveries.delete(digest(input.recoveryToken)); response.json({ ok: true });
  });
  const mail = accountMail(app, state); mail.publicRoutes();
  app.use("/api/v1", async (request, response, next) => {
    if (/^\/(?:health\/|setup\/|public\/status|metrics$)/u.test(request.path)) { next(); return; }
    try {
      if (state.runtime?.restoring && !request.path.startsWith("/admin/backups")) throw new Error("RESTORE_IN_PROGRESS");
      const database = store(); const bearer = request.headers.authorization;
      let userId: string | undefined; let authentication: Identity["authentication"] = "session"; let scopes: string[] | undefined;
      let csrf: string | undefined;
      if (bearer?.startsWith("Bearer nst_")) {
        const token = (await database.list("ApiToken", { filters: [{ field: "tokenHash", op: "eq", value: digest(bearer.slice(11)) }], limit: 1 }))[0];
        if (!token || token.revokedAt || (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now())) throw new Error("AUTH_INVALID");
        userId = token.userId; scopes = token.scopes; authentication = "token";
      } else {
        const raw = request.cookies?.netsentinel_session as string | undefined;
        const session = raw ? await database.get("Session", digest(raw)) : null;
        if (!session || new Date(session.expiresAt).getTime() <= Date.now()) throw new Error("AUTH_INVALID");
        userId = session.userId; csrf = session.csrfHash; (request as UserRequest).sessionHash = session.idHash;
      }
      const user = await database.get("User", userId);
      if (!user || user.disabledAt) throw new Error("AUTH_INVALID");
      if (authentication === "session" && !["GET", "HEAD", "OPTIONS"].includes(request.method) && digest(String(request.headers["x-csrf-token"] ?? "")) !== csrf) throw new Error("AUTH_CSRF");
      if (user.forcePasswordChange && !["/auth/me", "/auth/me/password", "/auth/logout"].includes(request.path)) throw new Error("PASSWORD_CHANGE_REQUIRED");
      (request as UserRequest).principal = await identity(database, user, authentication, scopes);
      next();
    } catch (error) { next(error); }
  });
  mail.privateRoutes();
  app.get("/api/v1/auth/me", (request, response) => response.json({ user: (request as UserRequest).principal }));
  app.post("/api/v1/auth/logout", async (request, response) => {
    const id = (request as UserRequest).sessionHash;
    if (id) await store().transaction((tx) => tx.remove("Session", id));
    response.clearCookie("netsentinel_session", { path: "/" }); response.json({ ok: true });
  });
  app.post("/api/v1/auth/me/password", async (request, response) => {
    const user = await verifyPassword(request as UserRequest, request.body);
    const input = z.object({ newPassword: z.string().min(12).max(1024) }).parse(request.body);
    if (await passwordMatches(user.passwordHash, input.newPassword)) throw new Error("PASSWORD_UNCHANGED");
    const encoded = await passwordHash(input.newPassword);
    await store().transaction(async (tx) => {
      await tx.put("User", { ...user, passwordHash: encoded, forcePasswordChange: false }, user.version);
      for (const session of await tx.list("Session", { filters: [{ field: "userId", op: "eq", value: user.id }] })) if (session.idHash !== (request as UserRequest).sessionHash) await tx.remove("Session", session.idHash);
    });
    response.json({ ok: true });
  });
  app.get("/api/v1/auth/me/security", async (request, response) => {
    const security = await store().get("AccountSecurity", (request as UserRequest).principal.id);
    response.json({ totpEnabled: Boolean(security?.totpEncrypted), recoveryConfigured: Boolean(security?.recoveryHash), backupCodesRemaining: security?.backupHashes.length ?? 0 });
  });
  app.post("/api/v1/auth/me/security/enroll", async (request, response) => {
    const user = await verifyPassword(request as UserRequest, request.body);
    const security = await store().get("AccountSecurity", user.id);
    if (security?.totpEncrypted) throw new Error("AUTH_2FA_ALREADY_ENABLED");
    const secret = totpSecret(); enrollments.set((request as UserRequest).sessionHash!, { secret, expires: Date.now() + 300000 });
    const otpauth = `otpauth://totp/${encodeURIComponent(`NetSentinel:${user.username ?? user.email}`)}?secret=${secret}&issuer=NetSentinel`;
    response.json({ secret, otpauth, qrCode: await QRCode.toDataURL(otpauth) });
  });
  app.post("/api/v1/auth/me/security/confirm", async (request, response) => {
    const user = await verifyPassword(request as UserRequest, request.body);
    const input = z.object({ code: z.string().max(128) }).parse(request.body);
    const pending = enrollments.get((request as UserRequest).sessionHash!);
    const counter = pending && pending.expires > Date.now() ? verifyTotp(pending.secret, input.code) : null;
    if (!pending || counter === null) throw new Error("AUTH_2FA_INVALID");
    const backup = newBackupCodes();
    await store().transaction(async (tx) => {
      const security = await tx.get("AccountSecurity", user.id);
      await tx.put("AccountSecurity", { ...security, userId: user.id, totpEncrypted: encryptTotp(pending.secret, state.config.key, user.id), totpLastCounter: counter, backupHashes: backup.hashes }, security?.version);
    });
    enrollments.delete((request as UserRequest).sessionHash!);
    response.json({ backupCodes: backup.codes });
  });
  app.post("/api/v1/auth/me/security/rotate", async (request, response) => {
    const user = await verifyPassword(request as UserRequest, request.body);
    const input = z.object({ target: z.enum(["recovery", "backup", "disable"]), code: z.string().max(128).optional() }).parse(request.body);
    const recovery = newRecovery(); const backup = newBackupCodes();
    await store().transaction(async (tx) => {
      const security = await tx.get("AccountSecurity", user.id);
      if (security?.totpEncrypted) await verifySecondFactor(tx, user.id, input.code ?? "", state.config.key);
      if (!security?.totpEncrypted && input.target === "backup") throw new Error("AUTH_2FA_INVALID");
      const current = await tx.get("AccountSecurity", user.id);
      await tx.put("AccountSecurity", { ...current, userId: user.id, ...(input.target === "recovery" ? { recoveryHash: recovery.hash } : input.target === "backup" ? { backupHashes: backup.hashes } : { totpEncrypted: null, totpLastCounter: -1, backupHashes: [] }) }, current?.version);
    });
    response.json(input.target === "recovery" ? { recoveryKey: recovery.key } : input.target === "backup" ? { backupCodes: backup.codes } : { ok: true });
  });
}
