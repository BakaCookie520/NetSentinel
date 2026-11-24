import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PERMISSIONS } from "@netsentinel/contracts";
import type { Store } from "../storage/store.js";
import { InstallationConfig, databaseSchema, openDatabase, type DatabaseConfig } from "./config.js";
import { passwordHash, digest, newRecovery, newBackupCodes, totpSecret, verifyTotp, encryptTotp, issueSession, passwordMatches } from "./security.js";
import type { CombinedRuntime } from "./runtime.js";
import QRCode from "qrcode";
import { entities, privateSetting } from "../storage/model.js";
import { requireLegacyDrain } from "./legacy.js";
import { findAccount, hasIdentifier, loginFields, legacyUsername, usernameSchema } from "./account-name.js";

export interface ApplicationState { config: InstallationConfig; store?: Store; runtime?: CombinedRuntime; activate(store: Store): Promise<void> }
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => schema.parse(body);
export function cookie(response: Response, raw: string) {
  response.cookie("netsentinel_session", raw, { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", maxAge: 8 * 3600000, path: "/" });
}
export function mountSetup(app: Express, state: ApplicationState) {
  const sessions = new Map<string, { csrf: string; expires: number; origin?: string }>();
  const drafts = new Map<string, { recovery: ReturnType<typeof newRecovery>; backup: ReturnType<typeof newBackupCodes>; secret: string }>();
  let busy = false;
  const closed = () => { if (state.config.state.initialized) throw new Error("SETUP_CLOSED"); };
  const authorize = (request: Request) => {
    closed();
    const id = request.cookies?.netsentinel_setup as string | undefined;
    const session = id ? sessions.get(id) : undefined;
    if (!session || session.expires < Date.now() || digest(String(request.headers["x-csrf-token"] ?? "")) !== session.csrf) throw new Error("SETUP_UNAUTHORIZED");
    if (session.origin && request.headers.origin && session.origin !== request.headers.origin) throw new Error("SETUP_ORIGIN_INVALID");
    return id!;
  };
  const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (busy) throw new Error("SETUP_BUSY");
    busy = true;
    try { return await operation(); } finally { busy = false; }
  };
  app.get("/api/v1/setup/status", (_request, response) => response.setHeader("Cache-Control", "no-store").json({ initialized: state.config.state.initialized, step: state.config.state.passwordHash ? 2 : state.config.state.database ? 1 : 0, database: state.config.state.database?.type ?? null }));
  app.post("/api/v1/setup/unlock", (request, response) => {
    closed();
    const input = parse(z.object({ token: z.string().max(256) }), request.body);
    if (!state.config.verify(input.token)) throw new Error("SETUP_UNAUTHORIZED");
    const id = randomBytes(32).toString("base64url"); const csrf = randomBytes(24).toString("base64url");
    sessions.set(id, { csrf: digest(csrf), expires: Date.now() + 30 * 60000, origin: request.headers.origin });
    response.cookie("netsentinel_setup", id, { httpOnly: true, sameSite: "strict", secure: process.env.COOKIE_SECURE === "true", path: "/api/v1/setup", maxAge: 30 * 60000 });
    response.json({ csrfToken: csrf, username: state.config.state.username, displayName: state.config.state.displayName });
  });
  app.post("/api/v1/setup/database", async (request, response) => {
    authorize(request);
    await exclusive(async () => {
      const config = parse(databaseSchema, request.body);
      const store = await openDatabase(config, true);
      try {
        const users = await store.list("User", { limit: 1 });
        if (users.length) { response.status(409).json({ detail: "SETUP_EXISTING_SITE", existingSite: true }); return; }
        for (const entity of entities) {
          const occupied = await store.list(entity, { limit: 100 });
          if (occupied.some((row) => entity !== "Setting" || (!privateSetting((row as { key: string }).key) && !["statusPageEnabled", "statusPageTitle", "statusPageDescription", "statusPageSupportUrl"].includes((row as { key: string }).key)))) throw new Error("SETUP_DATABASE_NOT_EMPTY");
        }
        await store.transaction(async (tx) => { await tx.put("Setting", { key: "__connectionTest", value: "ok" }); await tx.remove("Setting", "__connectionTest"); });
        if (state.store) await state.store.adapter.close();
        state.store = store;
        await state.config.save({ initialized: false, database: config });
        response.json({ ok: true, type: config.type });
      } finally { if (state.store !== store) await store.adapter.close(); }
    });
  });
  app.post("/api/v1/setup/adopt", async (request, response) => {
    authorize(request);
    await exclusive(async () => {
      const input = parse(z.object({ database: databaseSchema, ...loginFields, password: z.string().min(1).max(1024), code: z.string().optional() }).refine(hasIdentifier), request.body);
      const store = await openDatabase(input.database, true);
      try {
        const user = await findAccount(store, input);
        if (!user || user.disabledAt || !await passwordMatches(user.passwordHash, input.password)) throw new Error("AUTH_INVALID");
        const { identity, verifySecondFactor } = await import("./security.js");
        const principal = await identity(store, user);
        if (!principal.permissions.includes("user:manage")) throw new Error("AUTH_FORBIDDEN");
        const security = await store.get("AccountSecurity", user.id);
        if (security?.totpEncrypted) await store.transaction((tx) => verifySecondFactor(tx, user.id, input.code ?? "", state.config.key));
        await requireLegacyDrain(store);
        await store.transaction((tx) => tx.put("Setting", { key: "__initialized", value: true }));
        await state.activate(store); state.store = store;
        await state.config.save({ initialized: true, database: input.database });
        const session = await issueSession(store, user.id); cookie(response, session.raw);
        response.json({ user: session.user, csrfToken: session.csrfToken });
      } finally { if (state.store !== store) await store.adapter.close(); }
    });
  });
  app.post("/api/v1/setup/account", async (request, response) => {
    const id = authorize(request);
    await exclusive(async () => {
      if (!state.config.state.database || !state.store) throw new Error("SETUP_DATABASE_REQUIRED");
      const input = parse(z.object({ username: usernameSchema, displayName: z.string().trim().min(1).max(120).optional(), password: z.string().min(12).max(1024), confirmation: z.string() }), request.body);
      if (input.password !== input.confirmation) throw new Error("PASSWORD_MISMATCH");
      await state.config.save({ ...state.config.state, email: undefined, username: input.username, displayName: input.displayName ?? input.username, passwordHash: await passwordHash(input.password) });
      drafts.delete(id);
      response.json({ ok: true });
    });
  });
  app.post("/api/v1/setup/security", async (request, response) => {
    const id = authorize(request);
    if (!state.config.state.passwordHash) throw new Error("SETUP_ACCOUNT_REQUIRED");
    const draft = { recovery: newRecovery(), backup: newBackupCodes(), secret: totpSecret() };
    drafts.set(id, draft);
    const issuer = "NetSentinel"; const label = encodeURIComponent(`${issuer}:${state.config.state.username ?? state.config.state.email}`);
    const otpauth = `otpauth://totp/${label}?secret=${draft.secret}&issuer=${issuer}`;
    response.json({ recoveryKey: draft.recovery.key, backupCodes: draft.backup.codes, secret: draft.secret, otpauth, qrCode: await QRCode.toDataURL(otpauth) });
  });
  app.post("/api/v1/setup/finish", async (request, response) => {
    const id = authorize(request);
    await exclusive(async () => {
      const input = parse(z.object({ enableTotp: z.boolean(), code: z.string().max(128).optional(), recoverySaved: z.literal(true), origin: z.string().url().optional() }), request.body);
      const draft = drafts.get(id); const installation = state.config.state; const store = state.store;
      if (!draft || !(installation.username || installation.email) || !installation.passwordHash || !store) throw new Error("SETUP_SECURITY_REQUIRED");
      const counter = input.enableTotp ? verifyTotp(draft.secret, input.code ?? "") : -1;
      if (counter === null) throw new Error("AUTH_2FA_INVALID");
      const userId = await store.transaction(async (tx) => {
        if ((await tx.list("User", { limit: 1 })).length) throw new Error("SETUP_CLOSED");
        const role = await tx.put("Role", { name: "system-admin", system: true, permissions: [...PERMISSIONS] });
        const user = await tx.put("User", { email: installation.email ?? null, username: installation.username, displayName: installation.displayName!, passwordHash: installation.passwordHash! });
        if (!user.username) await tx.put("User", { ...user, username: legacyUsername(user.id) });
        await tx.put("UserRole", { userId: user.id, roleId: role.id });
        await tx.put("AccountSecurity", { userId: user.id, recoveryHash: draft.recovery.hash, totpEncrypted: input.enableTotp ? encryptTotp(draft.secret, state.config.key, user.id) : null, totpLastCounter: counter, backupHashes: input.enableTotp ? draft.backup.hashes : [] });
        await tx.put("Setting", { key: "__initialized", value: true });
        return user.id;
      });
      await state.activate(store);
      await state.config.save({ initialized: true, database: installation.database!, origin: input.origin ? new URL(input.origin).origin : request.headers.origin });
      drafts.clear(); sessions.clear();
      const session = await issueSession(store, userId); cookie(response, session.raw);
      response.clearCookie("netsentinel_setup", { path: "/api/v1/setup" });
      response.json({ user: session.user, csrfToken: session.csrfToken });
    });
  });
}
