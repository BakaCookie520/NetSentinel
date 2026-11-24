import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import multer, { memoryStorage } from "multer";
import { credentialInputSchema, monitorInputSchema, workflowInputSchema, PERMISSIONS, type CredentialInput } from "@netsentinel/contracts";
import { encryptSecret } from "@netsentinel/core";
import { readAvatar, removeAvatar, saveAvatar } from "../avatar-storage.js";
import { type EntityName, type EntityRow, privateSetting } from "../storage/model.js";
import type { UnitOfWork } from "../storage/store.js";
import { requirePermission as permission, type UserRequest } from "./auth-routes.js";
import { type ApplicationState } from "./setup.js";
import { digest, passwordHash, identity } from "./security.js";
import { usernameSchema } from "./account-name.js";
import { maintenanceActive } from "./runtime.js";
import { mapPublicOverallStatus, mapPublicServiceStatus } from "../public-status-state.js";

export const eq = (field: string, value: unknown) => ({ field, op: "eq" as const, value });
const nameSchema = z.string().trim().min(1).max(120);
const publicCredential = (credential: EntityRow<"Credential">) => { const { encrypted: _secret, ...view } = credential; return { ...view, configured: true }; };
const publicUser = (user: EntityRow<"User">) => { const { passwordHash: _hash, ...view } = user; return view; };
function secretOf(input: CredentialInput): string {
  if ("secret" in input) return input.type === "SSH_KEY" ? JSON.stringify({ privateKey: input.secret, ...(input.passphrase ? { passphrase: input.passphrase } : {}) }) : input.secret;
  if (input.type === "HTTP_BASIC") return JSON.stringify({ username: input.username, password: input.password });
  if (input.type === "HTTP_API_KEY") return JSON.stringify({ headerName: input.headerName, value: input.value });
  if (input.type === "WS_TOKEN") return JSON.stringify({ token: input.token, placement: input.placement, queryParamName: input.queryParamName });
  return JSON.stringify({ host: input.host, port: input.port, secure: input.secure, user: input.user, password: input.password, from: input.from });
}
const compatible = (type: string) => type === "WEBSOCKET" ? ["HTTP_BEARER", "HTTP_BASIC", "HTTP_API_KEY", "WS_TOKEN"] : ["HTTP", "WEBHOOK"].includes(type) ? ["HTTP_BEARER", "HTTP_BASIC", "HTTP_API_KEY"] : type === "SSH" ? ["SSH_PASSWORD", "SSH_KEY"] : type === "EMAIL" ? ["SMTP"] : [];
export function mountBusiness(app: Express, state: ApplicationState) {
  const store = () => { if (!state.store) throw new Error("SETUP_REQUIRED"); return state.store; };
  const runtime = () => { if (!state.runtime?.healthy) throw new Error("RUNTIME_UNAVAILABLE"); return state.runtime; };
  const actor = (request: Request) => (request as UserRequest).principal;
  const id = (request: Request) => String(request.params.id);
  const required = async <Name extends EntityName>(entity: Name, identifier: string) => {
    const row = await store().get(entity, identifier); if (!row) throw new Error("NOT_FOUND"); return row;
  };
  const audit = async (tx: UnitOfWork, request: Request, action: string, type: string, resourceId: string | null) => {
    await tx.put("AuditEvent", { actorId: actor(request).id, action, resourceType: type, resourceId });
  };
  const assertCredential = async (tx: UnitOfWork, credentialId: string | null | undefined, type: string) => {
    if (!credentialId) return;
    const credential = await tx.get("Credential", credentialId);
    if (!credential || !compatible(type).includes(credential.type)) throw new Error("CREDENTIAL_INCOMPATIBLE");
  };
  const monitorView = async (monitor: EntityRow<"Monitor">) => {
    const links = await store().all("MonitorTag", [eq("monitorId", monitor.id)]);
    const tags = await Promise.all(links.map((link) => store().get("Tag", link.tagId)));
    const publicStatus = { enabled: monitor.publicStatusEnabled, displayName: monitor.publicDisplayName ?? undefined, group: monitor.publicGroup, order: monitor.publicOrder };
    const credential = monitor.credentialId ? await store().get("Credential", monitor.credentialId) : null;
    return { ...monitor, publicStatus, tags: tags.filter(Boolean).map((tag) => tag!.name), credential: credential ? publicCredential(credential) : null, latencyMs: monitor.lastLatencyMs, configurationComplete: monitorInputSchema.safeParse({ ...monitor, tagIds: [], publicStatus }).success };
  };
  const workflowView = async (workflow: EntityRow<"Workflow">) => {
    const steps = await store().list("WorkflowStep", { filters: [eq("workflowId", workflow.id)], order: [{ field: "position", direction: "asc" }], limit: 1000 });
    const monitor = workflow.monitorId ? await store().get("Monitor", workflow.monitorId) : null;
    return { ...workflow, monitor, steps: await Promise.all(steps.map(async (step) => ({ ...step, credential: step.credentialId ? publicCredential(await required("Credential", step.credentialId)) : null }))), configurationComplete: workflowInputSchema.safeParse({ ...workflow, steps }).success };
  };
  const runView = async (identifier: string) => {
    const run = await required("WorkflowRun", identifier);
    const workflow = await required("Workflow", run.workflowId);
    const steps = await store().all("StepRun", [eq("workflowRunId", run.id)]);
    return { ...run, workflow: { id: workflow.id, name: workflow.name }, steps: await Promise.all(steps.map(async (step) => {
      const definition = await required("WorkflowStep", step.workflowStepId);
      return { ...step, name: definition.name, position: definition.position, type: definition.type };
    })) };
  };
  app.get("/api/v1/metrics", (_request, response) => response.type("text/plain").send(`netsentinel_runtime_ready ${state.runtime?.healthy ? 1 : 0}\n`));
  app.get("/api/v1/events", (request, response) => {
    const worker = runtime();
    response.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    response.flushHeaders();
    const listener = (event: { type: string; data: unknown }) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    worker.events.on("event", listener);
    const timer = setInterval(() => response.write(": heartbeat\n\n"), 15000);
    request.on("close", () => { clearInterval(timer); worker.events.off("event", listener); });
  });
  app.patch("/api/v1/auth/me", async (request, response) => {
    const input = z.object({ displayName: nameSchema }).parse(request.body);
    const user = await required("User", actor(request).id);
    const changed = await store().transaction((tx) => tx.put("User", { ...user, displayName: input.displayName, updatedAt: new Date().toISOString() }, user.version));
    response.json({ user: await identity(store(), changed) });
  });
  app.get("/api/v1/auth/me/avatar", async (request, response) => {
    const user = await required("User", actor(request).id);
    if (!user.avatarKey) throw new Error("NOT_FOUND");
    const avatar = await readAvatar(user.avatarKey);
    response.setHeader("Cache-Control", "private, max-age=300").type(avatar.image.contentType).send(avatar.buffer);
  });
  app.post("/api/v1/auth/me/avatar", multer({ storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single("avatar"), async (request, response) => {
    if (!request.file) throw new Error("AVATAR_REQUIRED");
    const user = await required("User", actor(request).id);
    const avatarKey = await saveAvatar(request.file.buffer);
    try {
      const changed = await store().transaction((tx) => tx.put("User", { ...user, avatarKey }, user.version));
      await removeAvatar(user.avatarKey); response.json({ user: await identity(store(), changed) });
    } catch (error) { await removeAvatar(avatarKey); throw error; }
  });
  app.delete("/api/v1/auth/me/avatar", async (request, response) => {
    const user = await required("User", actor(request).id);
    const changed = await store().transaction((tx) => tx.put("User", { ...user, avatarKey: null }, user.version));
    await removeAvatar(user.avatarKey); response.json({ user: await identity(store(), changed) });
  });
  app.get("/api/v1/monitors", permission("monitor:read"), async (_request, response) => response.json(await Promise.all((await store().list("Monitor", { limit: 1000 })).map(monitorView))));
  app.get("/api/v1/monitors/:id", permission("monitor:read"), async (request, response) => {
    const monitor = await required("Monitor", id(request));
    response.json({ ...await monitorView(monitor), results: await store().list("ProbeResult", { filters: [eq("monitorId", monitor.id)], order: [{ field: "checkedAt", direction: "desc" }], limit: 100 }), incidents: await store().list("Incident", { filters: [eq("monitorId", monitor.id)], order: [{ field: "openedAt", direction: "desc" }], limit: 20 }) });
  });
  const saveMonitor = async (request: Request, response: Response) => {
    const input = monitorInputSchema.parse(request.body);
    const version = request.method === "PATCH" ? z.object({ version: z.number().int() }).parse(request.body).version : undefined;
    const monitor = await store().transaction(async (tx) => {
      await assertCredential(tx, input.credentialId, input.type);
      const previous = version === undefined ? undefined : await required("Monitor", id(request));
      const { tagIds, publicStatus, ...data } = input;
      const row = await tx.put("Monitor", { ...previous, ...data, config: JSON.parse(JSON.stringify(data.config)) as EntityRow<"Monitor">["config"], credentialId: input.credentialId ?? null, publicStatusEnabled: publicStatus.enabled, publicDisplayName: publicStatus.displayName ?? null, publicGroup: publicStatus.group, publicOrder: publicStatus.order }, version);
      for (const link of await tx.list("MonitorTag", { filters: [eq("monitorId", row.id)] })) await tx.remove("MonitorTag", link);
      for (const tagId of tagIds) await tx.put("MonitorTag", { monitorId: row.id, tagId });
      await audit(tx, request, version === undefined ? "monitor.create" : "monitor.update", "monitor", row.id);
      return row;
    });
    response.status(version === undefined ? 201 : 200).json(await monitorView(monitor));
  };
  app.post("/api/v1/monitors", permission("monitor:write"), saveMonitor);
  app.patch("/api/v1/monitors/:id", permission("monitor:write"), saveMonitor);
  for (const paused of [true, false]) app.post(`/api/v1/monitors/:id/${paused ? "pause" : "resume"}`, permission("monitor:write"), async (request, response) => {
    const { version } = z.object({ version: z.number().int() }).parse(request.body);
    const monitor = await required("Monitor", id(request));
    const changed = await store().transaction((tx) => tx.put("Monitor", { ...monitor, enabled: !paused, status: paused ? "PAUSED" : "UNKNOWN", nextCheckAt: new Date().toISOString(), consecutiveFailures: 0, consecutiveSuccesses: 0 }, version));
    response.json(await monitorView(changed));
  });
  app.post("/api/v1/monitors/:id/check", permission("monitor:write"), async (request, response) => {
    await required("Monitor", id(request)); const job = await runtime().enqueueProbe(id(request), true); response.json({ queued: true, jobId: job.id });
  });
  app.delete("/api/v1/monitors/:id", permission("monitor:write"), async (request, response) => { await store().transaction((tx) => tx.remove("Monitor", id(request))); response.json({ ok: true }); });
  app.get("/api/v1/credentials", permission("credential:manage"), async (_request, response) => response.json((await store().all("Credential")).map(publicCredential)));
  const credentialSave = async (request: Request, response: Response) => {
    const input = credentialInputSchema.parse(request.body);
    const previous = request.method === "PATCH" ? await required("Credential", id(request)) : null;
    const identifier = previous?.id ?? randomUUID();
    const version = previous ? z.object({ version: z.number().int() }).parse(request.body).version : undefined;
    const changed = await store().transaction(async (tx) => {
      if (previous) {
        const monitors = await tx.list("Monitor", { filters: [eq("credentialId", identifier)] });
        const steps = await tx.list("WorkflowStep", { filters: [eq("credentialId", identifier)] });
        if ([...monitors, ...steps].some((item) => !compatible(item.type).includes(input.type))) throw new Error("CREDENTIAL_INCOMPATIBLE");
      }
      return tx.put("Credential", { ...previous, id: identifier, name: input.name, type: input.type, encrypted: { ...encryptSecret(secretOf(input), state.config.key, identifier) } }, version);
    });
    response.status(previous ? 200 : 201).json(publicCredential(changed));
  };
  app.post("/api/v1/credentials", permission("credential:manage"), credentialSave);
  app.patch("/api/v1/credentials/:id", permission("credential:manage"), credentialSave);
  app.delete("/api/v1/credentials/:id", permission("credential:manage"), async (request, response) => {
    await store().transaction(async (tx) => {
      if ((await tx.list("Monitor", { filters: [eq("credentialId", id(request))], limit: 1 })).length || (await tx.list("WorkflowStep", { filters: [eq("credentialId", id(request))], limit: 1 })).length) throw new Error("STORAGE_IN_USE");
      await tx.remove("Credential", id(request));
    }); response.json({ ok: true });
  });
  app.get("/api/v1/workflows", permission("workflow:read"), async (_request, response) => response.json(await Promise.all((await store().all("Workflow")).map(workflowView))));
  app.get("/api/v1/workflows/runs/:id", permission("workflow:read"), async (request, response) => response.json(await runView(id(request))));
  const workflowSave = async (request: Request, response: Response) => {
    const input = workflowInputSchema.parse(request.body);
    const previous = request.method === "PATCH" ? await required("Workflow", id(request)) : null;
    const version = previous ? z.object({ version: z.number().int() }).parse(request.body).version : undefined;
    const changed = await store().transaction(async (tx) => {
      const { steps, ...data } = input;
      const workflow = await tx.put("Workflow", { ...previous, ...data, monitorId: input.monitorId ?? null }, version);
      const existing = await tx.list("WorkflowStep", { filters: [eq("workflowId", workflow.id)], order: [{ field: "position", direction: "asc" }] });
      const activeRuns = await tx.list("WorkflowRun", { filters: [eq("workflowId", workflow.id), { field: "status", op: "in", value: ["PENDING", "RUNNING"] }], limit: 1 });
      if (previous && activeRuns.length) throw new Error("WORKFLOW_RUNNING");
      for (let position = 0; position < steps.length; position += 1) {
        const step = steps[position]!; await assertCredential(tx, step.credentialId, step.type);
        await tx.put("WorkflowStep", { ...existing[position], ...step, workflowId: workflow.id, position, credentialId: step.credentialId ?? null });
      }
      for (const step of existing.slice(steps.length)) {
        if ((await tx.list("StepRun", { filters: [eq("workflowStepId", step.id)], limit: 1 })).length) throw new Error("STORAGE_IN_USE");
        await tx.remove("WorkflowStep", step.id);
      }
      return workflow;
    });
    response.status(previous ? 200 : 201).json(await workflowView(changed));
  };
  app.post("/api/v1/workflows", permission("workflow:write"), workflowSave);
  app.patch("/api/v1/workflows/:id", permission("workflow:write"), workflowSave);
  app.delete("/api/v1/workflows/:id", permission("workflow:write"), async (request, response) => { await store().transaction((tx) => tx.remove("Workflow", id(request))); response.json({ ok: true }); });
  app.post("/api/v1/workflows/:id/execute", permission("workflow:execute"), async (request, response) => {
    const workflow = await required("Workflow", id(request));
    if (!workflow.enabled || !(await workflowView(workflow)).configurationComplete) throw new Error("CONFIG_INVALID");
    const run = await store().transaction((tx) => runtime().enqueueWorkflow(tx, workflow, null, "MANUAL", `manual:${workflow.id}:${randomUUID()}`));
    response.json(await runView(run.id));
  });
  app.get("/api/v1/incidents", permission("incident:read"), async (_request, response) => response.json(await Promise.all((await store().list("Incident", { order: [{ field: "openedAt", direction: "desc" }], limit: 100 })).map(async (incident) => ({
    ...incident, monitor: await required("Monitor", incident.monitorId), assignee: incident.assigneeId ? publicUser(await required("User", incident.assigneeId)) : null,
    comments: await Promise.all((await store().all("IncidentComment", [eq("incidentId", incident.id)])).map(async (comment) => ({ ...comment, author: publicUser(await required("User", comment.authorId)) }))),
  })))));
  app.post("/api/v1/incidents/:id/acknowledge", permission("incident:manage"), async (request, response) => { const item = await required("Incident", id(request)); response.json(await store().transaction((tx) => tx.put("Incident", { ...item, status: "ACKNOWLEDGED", acknowledgedAt: new Date().toISOString() }, item.version))); });
  app.post("/api/v1/incidents/:id/comments", permission("incident:manage"), async (request, response) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(request.body);
    response.json(await store().transaction((tx) => tx.put("IncidentComment", { incidentId: id(request), authorId: actor(request).id, body: text })));
  });
  app.patch("/api/v1/incidents/:id/assignee", permission("incident:manage"), async (request, response) => {
    const { assigneeId } = z.object({ assigneeId: z.string().nullable() }).parse(request.body); const item = await required("Incident", id(request));
    response.json(await store().transaction((tx) => tx.put("Incident", { ...item, assigneeId }, item.version)));
  });
  app.delete("/api/v1/incidents/:id", permission("incident:manage"), async (request, response) => {
    await store().transaction(async (tx) => {
      const runs = await tx.list("WorkflowRun", { filters: [eq("incidentId", id(request))] });
      if (runs.some((run) => ["PENDING", "RUNNING"].includes(run.status))) throw new Error("WORKFLOW_RUNNING");
      for (const run of runs) await tx.put("WorkflowRun", { ...run, incidentId: null });
      await tx.remove("Incident", id(request)); await audit(tx, request, "incident.delete", "incident", id(request));
    }); response.json({ ok: true });
  });
  app.get("/api/v1/approvals", permission("workflow:approve"), async (_request, response) => response.json(await Promise.all((await store().list("Approval", { filters: [eq("status", "PENDING"), { field: "expiresAt", op: "gt", value: new Date().toISOString() }], limit: 100 })).map(async (approval) => {
    const incident = await required("Incident", approval.incidentId);
    return { ...approval, workflow: await required("Workflow", approval.workflowId), incident: { ...incident, monitor: await required("Monitor", incident.monitorId) } };
  }))));
  for (const decision of ["approve", "reject"]) app.post(`/api/v1/approvals/:id/${decision}`, permission("workflow:approve"), async (request, response) => {
    const run = await store().transaction(async (tx) => {
      const approval = await tx.get("Approval", id(request));
      if (!approval || approval.status !== "PENDING" || new Date(approval.expiresAt).getTime() < Date.now()) throw new Error("STORAGE_CONFLICT");
      await tx.put("Approval", { ...approval, status: decision === "approve" ? "APPROVED" : "REJECTED", decidedAt: new Date().toISOString(), decidedById: actor(request).id });
      if (decision === "reject") return null;
      const workflow = await required("Workflow", approval.workflowId);
      return runtime().enqueueWorkflow(tx, workflow, approval.incidentId, "DOWN", `${approval.incidentId}:DOWN:${workflow.id}`);
    }); response.json(run ? await runView(run.id) : { id: id(request), status: "REJECTED" });
  });
  const maintenanceSchema = z.object({ name: nameSchema, monitorId: z.string().nullable().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(), cron: z.string().nullable().optional(), durationMinutes: z.number().int().positive().nullable().optional(), timezone: z.string().default("UTC"), enabled: z.boolean().default(true) }).superRefine((value, context) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }); } catch { context.addIssue({ code: "custom", message: "Invalid timezone" }); }
    if (value.cron ? !value.durationMinutes : !value.startsAt || !value.endsAt || value.startsAt >= value.endsAt) context.addIssue({ code: "custom", message: "Invalid maintenance schedule" });
  });
  app.get("/api/v1/maintenance-windows", permission("monitor:read"), async (_request, response) => response.json(await Promise.all((await store().all("MaintenanceWindow")).map(async (window) => ({ ...window, monitor: window.monitorId ? await required("Monitor", window.monitorId) : null })))));
  for (const method of ["post", "patch"] as const) app[method](`/api/v1/maintenance-windows${method === "patch" ? "/:id" : ""}`, permission("monitor:write"), async (request, response) => {
    const input = maintenanceSchema.parse(request.body);
    const previous = method === "patch" ? await required("MaintenanceWindow", id(request)) : null;
    const version = previous ? z.object({ version: z.number().int() }).parse(request.body).version : undefined;
    response.json(await store().transaction((tx) => tx.put("MaintenanceWindow", { ...previous, ...input, monitorId: input.monitorId ?? null, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, cron: input.cron ?? null, durationMinutes: input.durationMinutes ?? null }, version)));
  });
  app.delete("/api/v1/maintenance-windows/:id", permission("monitor:write"), async (request, response) => { await store().transaction((tx) => tx.remove("MaintenanceWindow", id(request))); response.json({ ok: true }); });
  app.get("/api/v1/tags", permission("monitor:read"), async (_request, response) => response.json(await store().all("Tag")));
  app.post("/api/v1/tags", permission("monitor:write"), async (request, response) => {
    const input = z.object({ name: nameSchema, color: z.string().regex(/^#[0-9a-f]{6}$/iu).default("#1976d2") }).parse(request.body);
    response.status(201).json(await store().transaction((tx) => tx.put("Tag", input)));
  });
  app.get("/api/v1/agents", permission("agent:read"), async (_request, response) => response.json((await store().all("Agent")).map(({ tokenHash: _token, ...agent }) => agent)));
  app.post("/api/v1/agents/enroll", permission("agent:manage"), async (request, response) => {
    const { name } = z.object({ name: nameSchema }).parse(request.body); const token = randomBytes(32).toString("base64url");
    const agent = await store().transaction((tx) => tx.put("Agent", { name, tokenHash: digest(token) })); response.json({ id: agent.id, enrollmentToken: token });
  });
  for (const action of ["rotate", "revoke"]) app[action === "rotate" ? "post" : "delete"](`/api/v1/agents/:id${action === "rotate" ? "/rotate" : ""}`, permission("agent:manage"), async (request, response) => {
    const { rowVersion } = z.object({ rowVersion: z.number().int() }).parse(request.body); const token = randomBytes(32).toString("base64url");
    await store().transaction(async (tx) => {
      const agent = await tx.get("Agent", id(request));
      if (!agent || agent.rowVersion !== rowVersion) throw new Error("STORAGE_CONFLICT");
      await tx.put("Agent", { ...agent, rowVersion: rowVersion + 1, ...(action === "rotate" ? { tokenHash: digest(token), enrolledAt: null, revokedAt: null, status: "OFFLINE" } : { status: "REVOKED", revokedAt: new Date().toISOString() }) });
    });
    state.runtime?.events.emit("agent.revoke", id(request));
    response.json(action === "rotate" ? { enrollmentToken: token } : { ok: true });
  });
  const roleSchema = z.object({ name: nameSchema, description: z.string().max(1000).nullable().optional(), permissions: z.array(z.enum(PERMISSIONS)) });
  app.get("/api/v1/admin/roles", permission("role:manage"), async (_request, response) => response.json(await store().all("Role")));
  for (const method of ["post", "patch"] as const) app[method](`/api/v1/admin/roles${method === "patch" ? "/:id" : ""}`, permission("role:manage"), async (request, response) => {
    const input = roleSchema.parse(request.body); const previous = method === "patch" ? await required("Role", id(request)) : null;
    if (previous?.system) throw new Error("ROLE_SYSTEM");
    const version = previous ? z.object({ version: z.number().int() }).parse(request.body).version : undefined;
    response.json(await store().transaction((tx) => tx.put("Role", { ...previous, ...input, description: input.description ?? null }, version)));
  });
  app.delete("/api/v1/admin/roles/:id", permission("role:manage"), async (request, response) => {
    const role = await required("Role", id(request)); if (role.system || (await store().list("UserRole", { filters: [eq("roleId", role.id)], limit: 1 })).length) throw new Error("STORAGE_IN_USE");
    await store().transaction((tx) => tx.remove("Role", role.id)); response.json({ ok: true });
  });
  app.get("/api/v1/admin/users", permission("user:manage"), async (_request, response) => response.json(await Promise.all((await store().all("User")).map(async (user) => ({
    ...publicUser(user), roles: await Promise.all((await store().all("UserRole", [eq("userId", user.id)])).map(async (link) => ({ role: await required("Role", link.roleId) }))),
  })))));
  app.post("/api/v1/admin/users", permission("user:manage"), async (request, response) => {
    const input = z.object({ username: usernameSchema, displayName: nameSchema, password: z.string().min(12).max(1024), roleIds: z.array(z.string()) }).parse(request.body);
    const encoded = await passwordHash(input.password);
    const user = await store().transaction(async (tx) => {
      const user = await tx.put("User", { username: input.username, displayName: input.displayName, passwordHash: encoded, forcePasswordChange: true });
      for (const roleId of input.roleIds) await tx.put("UserRole", { userId: user.id, roleId });
      return user;
    }); response.status(201).json(publicUser(user));
  });
  app.patch("/api/v1/admin/users/:id", permission("user:manage"), async (request, response) => {
    const input = z.object({ version: z.number().int(), displayName: nameSchema, locale: z.enum(["zh-CN", "en-US"]), timezone: z.string(), disabled: z.boolean(), roleIds: z.array(z.string()) }).parse(request.body);
    if (id(request) === actor(request).id && input.disabled) throw new Error("AUTH_FORBIDDEN");
    await store().transaction(async (tx) => {
      const user = await required("User", id(request));
      await tx.put("User", { ...user, displayName: input.displayName, locale: input.locale, timezone: input.timezone, disabledAt: input.disabled ? new Date().toISOString() : null }, input.version);
      for (const link of await tx.list("UserRole", { filters: [eq("userId", user.id)] })) await tx.remove("UserRole", link);
      for (const roleId of input.roleIds) await tx.put("UserRole", { userId: user.id, roleId });
    }); response.json({ ok: true });
  });
  app.get("/api/v1/tokens", permission("token:manage"), async (request, response) => response.json((await store().all("ApiToken", [eq("userId", actor(request).id)])).map(({ tokenHash: _token, ...token }) => token)));
  app.post("/api/v1/tokens", permission("token:manage"), async (request, response) => {
    const input = z.object({ name: nameSchema, scopes: z.array(z.enum(PERMISSIONS)), expiresAt: z.string().datetime().optional() }).parse(request.body);
    if (input.scopes.some((scope) => !actor(request).permissions.includes(scope))) throw new Error("AUTH_FORBIDDEN");
    const raw = randomBytes(32).toString("base64url");
    const token = await store().transaction((tx) => tx.put("ApiToken", { name: input.name, scopes: input.scopes, userId: actor(request).id, tokenHash: digest(raw), expiresAt: input.expiresAt ?? null }));
    response.json({ id: token.id, token: `nst_${raw}` });
  });
  app.delete("/api/v1/tokens/:id", permission("token:manage"), async (request, response) => {
    const token = await required("ApiToken", id(request)); if (token.userId !== actor(request).id) throw new Error("AUTH_FORBIDDEN");
    await store().transaction((tx) => tx.put("ApiToken", { ...token, revokedAt: new Date().toISOString() })); response.json({ ok: true });
  });
  app.get("/api/v1/admin/audit-events", permission("audit:read"), async (_request, response) => response.json(await store().list("AuditEvent", { order: [{ field: "createdAt", direction: "desc" }], limit: 200 })));
  app.get("/api/v1/admin/settings", permission("settings:manage"), async (_request, response) => response.json((await store().all("Setting")).filter((item) => !privateSetting(item.key))));
  for (const method of ["post", "put"] as const) app[method]("/api/v1/admin/settings", permission("settings:manage"), async (request, response) => {
    const schema = z.object({ key: z.string().min(1).max(120).refine((value) => !privateSetting(value)), value: z.json(), version: z.number().int().optional() });
    const input = method === "post" ? [schema.parse(request.body)] : z.object({ settings: z.array(schema) }).parse(request.body).settings;
    await store().transaction(async (tx) => {
      for (const setting of input) {
        if (setting.key === "statusPageEnabled" && typeof setting.value !== "boolean") throw new Error("SETTING_INVALID");
        if (setting.key === "statusPageTitle" && (typeof setting.value !== "string" || !setting.value.trim() || setting.value.length > 80)) throw new Error("SETTING_INVALID");
        if (setting.key === "statusPageDescription" && (typeof setting.value !== "string" || setting.value.length > 300)) throw new Error("SETTING_INVALID");
        if (setting.key === "statusPageSupportUrl" && setting.value !== null) {
          if (typeof setting.value !== "string") throw new Error("SETTING_INVALID");
          try { if (!["http:", "https:", "mailto:"].includes(new URL(setting.value).protocol)) throw new Error(); }
          catch { throw new Error("SETTING_INVALID"); }
        }
        const previous = await tx.get("Setting", setting.key);
        await tx.put("Setting", { ...previous, key: setting.key, value: setting.value }, setting.version);
      }
    }); response.json((await store().all("Setting")).filter((item) => !privateSetting(item.key)));
  });
  app.get("/api/v1/dashboard", permission("monitor:read"), async (_request, response) => {
    const now = Date.now(); let total = 0; let good = 0;
    const buckets = new Map<string, number[]>();
    for await (const probe of store().iterate("ProbeResult", { filters: [{ field: "checkedAt", op: "gte", value: new Date(now - 86400000).toISOString() }] })) {
      total += 1; if (probe.ok) good += 1;
      if (probe.latencyMs !== null && new Date(probe.checkedAt).getTime() >= now - 43200000) {
        const bucket = `${probe.checkedAt.slice(0, 13)}:00:00.000Z`; const values = buckets.get(bucket) ?? []; values.push(probe.latencyMs); buckets.set(bucket, values);
      }
    }
    response.json({ monitors: await Promise.all((await store().all("Monitor")).map(monitorView)), openIncidents: (await store().all("Incident", [{ field: "status", op: "ne", value: "RESOLVED" }])).length,
      pendingApprovals: (await store().all("Approval", [eq("status", "PENDING"), { field: "expiresAt", op: "gt", value: new Date().toISOString() }])).length,
      uptimePercent: total ? Number((good / total * 100).toFixed(2)) : null, probeResults24h: total,
      latencyTrend: [...buckets].sort(([left], [right]) => left.localeCompare(right)).map(([bucket, values]) => {
        values.sort((left, right) => left - right); const middle = Math.floor(values.length / 2); return { bucket, p50Ms: values.length % 2 ? values[middle] : (values[middle - 1]! + values[middle]!) / 2 };
      }),
    });
  });
  app.get("/api/v1/logs", async (request, response) => {
    const source = String(request.query.source ?? "ALL"); const status = String(request.query.status ?? "ALL");
    const limit = Math.min(100, Math.max(10, Number(request.query.limit ?? 50)));
    const canProbe = actor(request).permissions.includes("monitor:read"); const canAction = actor(request).permissions.includes("workflow:read");
    if ((!canProbe && !canAction) || (source === "PROBE" && !canProbe) || (source === "ACTION" && !canAction)) throw new Error("AUTH_FORBIDDEN");
    const before = String(request.query.cursor ?? new Date(Date.now() + 1000).toISOString());
    const monitorFilter = request.query.monitorId ? [eq("monitorId", String(request.query.monitorId))] : [];
    const search = String(request.query.search ?? "").toLowerCase();
    const items: Array<Record<string, unknown> & { timestamp: string; status: string }> = [];
    if (canProbe && source !== "ACTION" && !request.query.runId && !["IN_PROGRESS", "UNKNOWN"].includes(status)) {
      for (const probe of await store().list("ProbeResult", { filters: [...monitorFilter, { field: "checkedAt", op: "lt", value: before }], order: [{ field: "checkedAt", direction: "desc" }], limit: limit * 4 })) {
        const monitor = await required("Monitor", probe.monitorId);
        items.push({ id: `probe:${probe.id}`, source: "PROBE", timestamp: probe.checkedAt, status: probe.ok ? "SUCCESS" : "FAILURE", title: monitor.name, summary: probe.errorMessage ?? (probe.ok ? "Probe succeeded" : "Probe failed"), monitor, durationMs: probe.latencyMs, details: { statusCode: probe.statusCode, errorCode: probe.errorCode, errorMessage: probe.errorMessage } });
      }
    }
    if (canAction && source !== "PROBE") for (const run of await store().list("WorkflowRun", { filters: [{ field: "createdAt", op: "lt", value: before }, ...(request.query.runId ? [eq("id", String(request.query.runId))] : [])], order: [{ field: "createdAt", direction: "desc" }], limit: limit * 4 })) {
      const view = await runView(run.id); const workflow = await required("Workflow", run.workflowId); const monitor = workflow.monitorId ? await required("Monitor", workflow.monitorId) : null;
      if (request.query.monitorId && monitor?.id !== request.query.monitorId) continue;
      items.push({ id: `action:${run.id}`, source: "ACTION", timestamp: run.createdAt, status: run.status === "SUCCEEDED" ? "SUCCESS" : ["FAILED", "CANCELLED"].includes(run.status) ? "FAILURE" : run.status === "UNKNOWN" ? "UNKNOWN" : "IN_PROGRESS", title: workflow.name, summary: run.status, monitor,
        details: { runId: run.id, trigger: run.trigger, runStatus: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, steps: view.steps.map((step) => ({ ...step, durationMs: step.startedAt && step.finishedAt ? Date.parse(step.finishedAt) - Date.parse(step.startedAt) : null })) } });
    }
    const filtered = items.filter((item) => (status === "ALL" || item.status === status) && (!search || JSON.stringify(item).toLowerCase().includes(search))).sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    response.json({ items: filtered.slice(0, limit), nextCursor: filtered.length > limit ? filtered[limit - 1]!.timestamp : null });
  });
  app.get("/api/v1/public/status", async (_request, response) => {
    const settings = new Map((await store().all("Setting")).map((item) => [item.key, item.value]));
    if (settings.get("statusPageEnabled") === false) { response.json({ enabled: false, generatedAt: new Date().toISOString() }); return; }
    const monitors = (await store().all("Monitor", [eq("publicStatusEnabled", true)])).filter((item) => item.publicDisplayName);
    const windows = await store().all("MaintenanceWindow"); const groups = new Map<string, unknown[]>(); const statuses: ReturnType<typeof mapPublicServiceStatus>[] = [];
    const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - 89);
    for (const monitor of monitors.sort((left, right) => left.publicGroup.localeCompare(right.publicGroup) || left.publicOrder - right.publicOrder)) {
      const metrics = await store().all("StatusDailyMetric", [eq("monitorId", monitor.id), { field: "day", op: "gte", value: since.toISOString() }]);
      let total = 0; let success = 0;
      const history = Array.from({ length: 90 }, (_, index) => {
        const date = new Date(since.getTime() + index * 86400000).toISOString().slice(0, 10); const metric = metrics.find((item) => item.day.slice(0, 10) === date);
        const count = (metric?.successCount ?? 0) + (metric?.failureCount ?? 0); total += count; success += metric?.successCount ?? 0;
        const uptimePercent = count ? Number(((metric!.successCount / count) * 100).toFixed(2)) : null;
        return { date, uptimePercent, status: uptimePercent === null ? "NO_DATA" : uptimePercent === 100 ? "OPERATIONAL" : uptimePercent === 0 ? "OUTAGE" : "DEGRADED" };
      });
      const status = mapPublicServiceStatus(monitor.status, !monitor.enabled || windows.some((window) => (!window.monitorId || window.monitorId === monitor.id) && maintenanceActive(window)));
      statuses.push(status); const group = groups.get(monitor.publicGroup) ?? [];
      group.push({ id: monitor.id, name: monitor.publicDisplayName, status, uptimePercent: total ? Number((success / total * 100).toFixed(2)) : null, history }); groups.set(monitor.publicGroup, group);
    }
    const incidents = (await store().list("Incident", { order: [{ field: "openedAt", direction: "desc" }], limit: 100 })).filter((incident) => monitors.some((monitor) => monitor.id === incident.monitorId)).slice(0, 20);
    response.setHeader("Cache-Control", "public, max-age=15").json({ enabled: true, generatedAt: new Date().toISOString(), title: settings.get("statusPageTitle") ?? "NetSentinel Status", description: settings.get("statusPageDescription") ?? "", supportUrl: settings.get("statusPageSupportUrl") ?? null, themeColor: settings.get("themeColor") ?? "sky", overallStatus: mapPublicOverallStatus(statuses), groups: [...groups].map(([name, services]) => ({ name, services })), incidents: incidents.map((incident) => ({ id: incident.id, serviceName: monitors.find((monitor) => monitor.id === incident.monitorId)?.publicDisplayName, status: incident.status === "RESOLVED" ? "RESOLVED" : "ACTIVE", startedAt: incident.openedAt, resolvedAt: incident.resolvedAt })) });
  });
}
