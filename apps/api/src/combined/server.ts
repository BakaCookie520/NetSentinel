import express, { type Request, type Response, type NextFunction, type Express } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { requireLegacyDrain } from "./legacy.js";
import { InstallationConfig, openDatabase } from "./config.js";
import { mountSetup, type ApplicationState } from "./setup.js";
import { mountAuth } from "./auth-routes.js";
import { mountBusiness } from "./routes.js";
import { CombinedRuntime } from "./runtime.js";
import { attachCombinedAgents } from "./agents.js";
import { mountPortableBackups } from "./portable-backup.js";
import { serveWebConsole } from "../web-console.js";
import { ZodError } from "zod";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { migrateAccountNames } from "./account-name.js";

export async function createCombinedApplication() {
  const config = new InstallationConfig(); await config.acquire();
  try { await config.open(); } catch (error) { await config.release(); throw error; }
  const app = express(); const server = createServer(app);
  let agents: ReturnType<typeof attachCombinedAgents>;
  const state: ApplicationState = { config, async activate(store) {
    if (state.runtime) throw new Error("INSTANCE_ALREADY_ACTIVE");
    await migrateAccountNames(store);
    const runtime = new CombinedRuntime(store, config.key);
    await runtime.start();
    state.runtime = runtime; state.store = store; agents?.bind();
  } };
  if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== "false") {
    if (process.env.TRUST_PROXY === "true") throw new Error("TRUST_PROXY_MUST_BE_EXPLICIT");
    app.set("trust proxy", /^\d+$/u.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY.split(","));
  }
  app.use(helmet({ contentSecurityPolicy: false }) as unknown as express.RequestHandler);
  app.use(cookieParser() as express.RequestHandler); app.use(express.json({ limit: "1mb" }));
  app.use("/api/v1", (request, response, next) => {
    const origin = request.headers.origin;
    const expected = process.env.WEB_ORIGIN?.trim() || config.state.origin;
    response.setHeader("Cache-Control", "private, no-store");
    const targetOrigin = `${request.protocol}://${request.get("host")}`;
    if (origin && origin !== (expected ?? targetOrigin)) { response.status(403).json({ detail: "ORIGIN_NOT_ALLOWED" }); return; }
    if (origin) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Access-Control-Allow-Credentials", "true"); response.setHeader("Vary", "Origin"); }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Headers", "content-type,x-csrf-token,authorization,if-match");
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS"); response.sendStatus(204); return;
    }
    next();
  });
  app.use(["/api/v1/setup/unlock", "/api/v1/setup/database", "/api/v1/setup/account", "/api/v1/setup/security", "/api/v1/setup/finish", "/api/v1/setup/adopt", "/api/v1/auth/login", "/api/v1/auth/two-factor", "/api/v1/auth/recover"], rateLimit({ windowMs: 15 * 60000, limit: 50, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use(["/api/v1/auth/recover/email", "/api/v1/auth/me/email", "/api/v1/admin/mail/test"], rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }));
  let writes = 0;
  app.use("/api/v1", (request, response, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !/^\/(?:setup\/|admin\/backups)/u.test(request.path)) {
      if (state.runtime?.restoring || (app.locals.backupBusy as boolean)) { response.status(503).json({ detail: "RESTORE_IN_PROGRESS" }); return; }
      writes += 1; let released = false;
      const release = () => { if (!released) { released = true; writes -= 1; } };
      response.once("finish", release); response.once("close", release);
    }
    next();
  });
  app.locals.drainWrites = async () => {
    const until = Date.now() + Number(process.env.NETSENTINEL_RESTORE_DRAIN_TIMEOUT_MS ?? 600000);
    while (writes && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25));
    if (writes) throw new Error("BACKUP_WRITERS_TIMEOUT");
  };
  mountSetup(app, state);
  app.get("/api/v1/health/live", (_request, response) => response.json({ status: "ok" }));
  app.get("/api/v1/health/ready", async (_request, response) => {
    if (!config.state.initialized) { response.json({ status: "setup", workerConnected: false, restoring: false }); return; }
    let connected = false;
    try { if (state.store) { await state.store.adapter.revision(); connected = true; } } catch { /* Readiness reports failure without credentials. */ }
    response.status(connected && state.runtime?.healthy ? 200 : 503).json({ status: connected && state.runtime?.healthy ? "ready" : "unavailable", workerConnected: Boolean(state.runtime?.healthy), restoring: Boolean(state.runtime?.restoring) });
  });
  mountAuth(app, state); mountPortableBackups(app, state); mountBusiness(app, state);
  app.get("/api/docs-json", (_request, response) => response.json({
    openapi: "3.0.3", info: { title: "NetSentinel API", version: "2.0" },
    components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "netsentinel_session" } } },
    paths: Object.fromEntries([
      ["setup/status", "get"], ["setup/unlock", "post"], ["setup/database", "post"], ["setup/account", "post"], ["setup/security", "post"], ["setup/finish", "post"],
      ["auth/login", "post"], ["auth/two-factor", "post"], ["auth/recover", "post"], ["auth/recover/confirm", "post"], ["auth/me", "get"], ["auth/me/security", "get"], ["auth/me/email", "get"], ["auth/recover/email/request", "post"], ["auth/recover/email/confirm", "post"], ["admin/mail", "get"], ["admin/mail/test", "post"], ["health/ready", "get"],
      ["monitors", "get"], ["workflows", "get"], ["credentials", "get"], ["incidents", "get"], ["agents", "get"], ["admin/backups", "get"],
    ].map(([path, method]) => [`/api/v1/${path}`, { [method!]: { responses: { "200": { description: "Success" }, "400": { description: "Invalid input" }, "401": { description: "Authentication required" } } } }])),
  }));
  app.get(["/api/docs", "/api/docs/"], (_request, response) => response.type("html").send('<!doctype html><html lang="en"><head><title>NetSentinel API</title><link rel="stylesheet" href="/api/docs/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/api/docs/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:"/api/docs-json",dom_id:"#swagger-ui"});</script></body></html>'));
  const require = createRequire(import.meta.url);
  app.use("/api/docs", express.static(dirname(require.resolve("swagger-ui-dist/swagger-ui-bundle.js"))));
  app.use("/api", (_request, response) => response.status(404).json({ detail: "NOT_FOUND" }));
  serveWebConsole(app);
  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) { response.destroy(); return; }
    const code = error instanceof Error ? error.message : "OPERATION_FAILED";
    const status = error instanceof ZodError ? 400 : code === "NOT_FOUND" ? 404 : ["AUTH_INVALID", "SETUP_UNAUTHORIZED"].includes(code) ? 401 : /AUTH_|ORIGIN_|PASSWORD_CHANGE_REQUIRED/u.test(code) ? 403 : /CONFLICT|BUSY|IN_USE|CLOSED|ACTIVE|EXISTING_SITE/u.test(code) ? 409 : /UNAVAILABLE|RESTORE_IN_PROGRESS|RECOVERY_REQUIRED/u.test(code) ? 503 : /^[A-Z][A-Z0-9_:]+$/u.test(code) ? 400 : 500;
    response.status(status).type("application/problem+json").json({ status, detail: status === 500 ? "OPERATION_FAILED" : error instanceof ZodError ? "Validation failed" : code, title: status === 500 ? "Internal error" : "Request failed", instance: request.path, ...(error instanceof ZodError ? { errors: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } : {}) });
  });
  agents = attachCombinedAgents(server, state);
  try {
  if (!config.state.database && process.env.DATABASE_URL) {
    const database = { type: "postgresql" as const, url: process.env.DATABASE_URL };
    const store = await openDatabase(database, true);
    state.store = store;
    if ((await store.list("User", { limit: 1 })).length) {
      await requireLegacyDrain(store);
      await store.transaction((tx) => tx.put("Setting", { key: "__initialized", value: true }));
      await config.save({ initialized: true, database, origin: process.env.WEB_ORIGIN });
      state.store = store;
    } else { state.store = store; await config.save({ initialized: false, database }); }
  } else if (config.state.database) state.store = await openDatabase(config.state.database, true);
  if (state.store && !config.state.initialized && (await state.store.get("Setting", "__initialized"))?.value === true) {
    await config.save({ initialized: true, database: config.state.database!, origin: config.state.origin });
  }
  await (app.locals.backups as { initialize(): Promise<void> }).initialize();
  if (config.state.initialized && state.store) await state.activate(state.store);
  } catch (error) {
    agents.close();
    await (app.locals.backups as { close(): Promise<void> }).close();
    await state.runtime?.close(); await state.store?.adapter.close(); await config.release();
    throw error;
  }
  return { app, server, state, async close() {
    agents.close();
    if (server.listening) { server.closeIdleConnections(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    await (app.locals.backups as { close(): Promise<void> }).close();
    await state.runtime?.close(); await state.store?.adapter.close(); await config.release();
  } };
}
export async function startCombinedApplication() {
  const application = await createCombinedApplication();
  await new Promise<void>((resolve) => application.server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", resolve));
  console.log(`NetSentinel combined runtime listening on ${process.env.PORT ?? 3000}`);
  let closing = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
    if (closing) return; closing = true;
    void application.close().then(() => process.exit(0), () => process.exit(1));
  });
}
