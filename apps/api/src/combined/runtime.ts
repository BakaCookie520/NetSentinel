import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { CronExpressionParser } from "cron-parser";
import { monitorInputSchema } from "@netsentinel/contracts";
import { advanceMonitorState, decryptSecret, isAddressAllowed, runHttpProbe, runWebSocketProbe, runTcpProbe, runIcmpProbe, type AuthorizedTarget, type ProbeResult, type SecretEnvelope } from "@netsentinel/core";
import { executeAction, buildCredentialHeaders, materializeWebSocketCredential, type ExecutionResult, type HttpCredentialType, type WebSocketCredentialType } from "@netsentinel/worker/execution";
import type { Store, UnitOfWork } from "../storage/store.js";
import type { EntityRow } from "../storage/model.js";

export function maintenanceActive(window: EntityRow<"MaintenanceWindow">, now = new Date()): boolean {
  if (!window.enabled) return false;
  if (window.startsAt && window.endsAt && new Date(window.startsAt) <= now && new Date(window.endsAt) > now) return true;
  if (!window.cron || !window.durationMinutes) return false;
  try { const previous = CronExpressionParser.parse(window.cron, { currentDate: now, tz: window.timezone }).prev().getTime(); return previous <= now.getTime() && previous + window.durationMinutes * 60000 > now.getTime(); }
  catch { return false; }
}
export class CombinedRuntime {
  readonly events = new EventEmitter();
  readonly owner = randomUUID();
  readonly active = new Set<Promise<void>>();
  paused = false;
  healthy = false;
  restoring = false;
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private lastHeartbeat = 0;
  private lastCleanup = 0;
  agentCommand: (id: string, command: string, timeout: number) => Promise<ExecutionResult> = async () => ({ status: "FAILED", error: "Agent offline" });
  constructor(readonly store: Store, readonly key: Buffer) {}
  async start() {
    await this.heartbeat();
    await this.store.transaction(async (tx) => {
      for (const job of await tx.list("DurableJob", { filters: [{ field: "status", op: "eq", value: "RUNNING" }] })) {
        await tx.put("DurableJob", { ...job, status: job.kind === "probe" ? "PENDING" : "UNKNOWN", error: "Process restarted; remote effects not replayed" });
        if (job.kind === "workflow") {
          const run = await tx.get("WorkflowRun", job.ownerId);
          if (run && ["PENDING", "RUNNING"].includes(run.status)) await tx.put("WorkflowRun", { ...run, status: "UNKNOWN", finishedAt: new Date().toISOString() });
        }
      }
      for (const table of ["WorkflowRun", "StepRun"] as const) for (const run of await tx.list(table, { filters: [{ field: "status", op: "eq", value: "RUNNING" }] })) await tx.put(table, { ...run, status: "UNKNOWN", finishedAt: new Date().toISOString() });
      for (const agent of await tx.list("Agent", { filters: [{ field: "status", op: "eq", value: "ONLINE" }] })) await tx.put("Agent", { ...agent, status: "OFFLINE" });
    });
    this.healthy = true;
    this.timer = setInterval(() => { void this.tick().catch(() => { this.healthy = false; }); }, 1000);
    this.timer.unref();
  }
  private async heartbeat() {
    await this.store.transaction(async (tx) => {
      const current = await tx.get("Setting", "__runtimeOwner");
      const value = current?.value as { owner: string; expires: number } | undefined;
      if (value && value.owner !== this.owner && value.expires > Date.now()) throw new Error("INSTANCE_ALREADY_ACTIVE");
      await tx.put("Setting", { key: "__runtimeOwner", value: { owner: this.owner, expires: Date.now() + 30000 } });
    });
    this.lastHeartbeat = Date.now(); this.healthy = true;
  }
  private async assertOwner() {
    const lease = await this.store.get("Setting", "__runtimeOwner");
    const value = lease?.value as { owner: string; expires: number } | undefined;
    if (value?.owner !== this.owner || value.expires <= Date.now()) {
      this.healthy = false; this.paused = true; throw new Error("INSTANCE_LEASE_LOST");
    }
  }
  async close() {
    this.paused = true; this.healthy = false;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(this.active);
    await this.store.transaction(async (tx) => { const current = await tx.get("Setting", "__runtimeOwner"); if ((current?.value as { owner?: string })?.owner === this.owner) await tx.remove("Setting", "__runtimeOwner"); });
  }
  async drain(timeout = Number(process.env.NETSENTINEL_RESTORE_DRAIN_TIMEOUT_MS ?? 600000)) {
    this.paused = true;
    const deadline = Date.now() + timeout;
    while ((this.ticking || this.active.size) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    if (this.ticking || this.active.size) throw new Error("BACKUP_DRAIN_TIMEOUT");
  }
  async enqueueProbe(id: string, force = false): Promise<EntityRow<"DurableJob">> {
    return this.store.transaction((tx) => tx.put("DurableJob", { id: `probe-${id}-${force ? randomUUID() : Date.now()}`, kind: "probe", ownerId: id }));
  }
  async enqueueWorkflow(tx: UnitOfWork, workflow: EntityRow<"Workflow">, incidentId: string | null, trigger: "DOWN" | "RECOVERY" | "MANUAL", idempotencyKey: string) {
    const existing = (await tx.list("WorkflowRun", { filters: [{ field: "idempotencyKey", op: "eq", value: idempotencyKey }], limit: 1 }))[0];
    if (existing) return existing;
    const run = await tx.put("WorkflowRun", { workflowId: workflow.id, incidentId, trigger, idempotencyKey });
    await tx.put("DurableJob", { id: run.id, kind: "workflow", ownerId: run.id });
    return run;
  }
  async authorize(hostname: string): Promise<AuthorizedTarget | null> {
    const settings = await this.store.list("Setting", { filters: [{ field: "key", op: "in", value: ["egressAllow", "egressDeny"] }] });
    const rules = new Map(settings.map((item) => [item.key, Array.isArray(item.value) ? item.value.map(String) : []]));
    const allow = rules.get("egressAllow") ?? []; const deny = rules.get("egressDeny") ?? [];
    const matches = (rule: string) => rule.startsWith("*.") ? hostname.endsWith(rule.slice(1)) : hostname === rule;
    if (deny.some((rule) => !rule.includes("/") && matches(rule))) return null;
    try {
      const addresses = await lookup(hostname.replace(/^\[|\]$/gu, ""), { all: true, verbatim: true });
      if (!addresses.length || !addresses.every(({ address }) => allow.some((rule) => !rule.includes("/") && matches(rule)) || isAddressAllowed(address, { allow: allow.filter((rule) => rule.includes("/")), deny: deny.filter((rule) => rule.includes("/")) }))) return null;
      const first = addresses[0]!; return { address: first.address, family: first.family as 4 | 6 };
    } catch { return null; }
  }
  async tick() {
    if (this.ticking) return;
    if (Date.now() - this.lastHeartbeat > 10000) await this.heartbeat();
    if (this.paused || !this.healthy || this.active.size >= 20) return;
    this.ticking = true;
    try {
      const now = new Date().toISOString();
      await this.store.transaction(async (tx) => {
        const monitors = await tx.list("Monitor", { filters: [{ field: "enabled", op: "eq", value: true }, { field: "nextCheckAt", op: "lte", value: now }], limit: 100 });
        for (const monitor of monitors) {
          await tx.put("DurableJob", { id: `probe-${monitor.id}-${new Date(monitor.nextCheckAt).getTime()}`, kind: "probe", ownerId: monitor.id });
          await tx.put("Monitor", { ...monitor, nextCheckAt: new Date(Date.now() + monitor.intervalSeconds * 1000).toISOString() });
        }
      });
      const jobs = await this.store.list("DurableJob", { filters: [{ field: "status", op: "eq", value: "PENDING" }, { field: "availableAt", op: "lte", value: now }], order: [{ field: "availableAt", direction: "asc" }], limit: 20 - this.active.size });
      for (const job of jobs) {
        if (job.kind === "workflow" && [...this.active].length >= 5) continue;
        await this.store.transaction(async (tx) => {
          const current = await tx.get("DurableJob", job.id);
          if (current?.status !== "PENDING") throw new Error("STORAGE_CONFLICT");
          await tx.put("DurableJob", { ...current, status: "RUNNING", startedAt: now }, current.version);
        });
        const operation = this.run(job).catch(() => undefined);
        this.active.add(operation); void operation.finally(() => this.active.delete(operation));
      }
      if (Date.now() - this.lastCleanup > 3600000) { await this.cleanup(); this.lastCleanup = Date.now(); }
    } finally { this.ticking = false; }
  }
  private async run(job: EntityRow<"DurableJob">) {
    let status = "SUCCEEDED"; let error: string | null = null;
    try { if (job.kind === "probe") await this.probe(job); else await this.workflow(job.ownerId); }
    catch { status = "UNKNOWN"; error = "Task interrupted; result uncertain"; }
    await this.store.transaction(async (tx) => {
      const current = await tx.get("DurableJob", job.id);
      if (current) await tx.put("DurableJob", { ...current, status, error, finishedAt: new Date().toISOString() });
    });
  }
  private async perform(monitor: EntityRow<"Monitor">): Promise<ProbeResult> {
    const parsed = monitorInputSchema.safeParse({ ...monitor, tagIds: [] });
    if (!parsed.success) return { ok: false, latencyMs: 0, errorCode: "CONFIG_INVALID", errorMessage: "Incomplete monitor configuration" };
    const input = parsed.data;
    const credential = monitor.credentialId ? await this.store.get("Credential", monitor.credentialId) : null;
    const secret = credential ? decryptSecret(credential.encrypted as unknown as SecretEnvelope, this.key, credential.id) : "";
    const authorize = this.authorize.bind(this);
    if (input.type === "HTTP") return runHttpProbe({ url: input.target, timeoutMs: input.timeoutMs, ...input.config, headers: { ...input.config.headers, ...(credential ? buildCredentialHeaders(credential.type as HttpCredentialType, secret) : {}) } }, authorize);
    if (input.type === "WEBSOCKET") {
      const materialized = credential ? materializeWebSocketCredential(input.target, credential.type as WebSocketCredentialType, secret) : { url: input.target, headers: {} };
      return runWebSocketProbe({ timeoutMs: input.timeoutMs, ...input.config, url: materialized.url, headers: { ...input.config.headers, ...materialized.headers } }, authorize);
    }
    if (input.type === "TCP") { const url = new URL(`tcp://${input.target}`); return runTcpProbe({ host: url.hostname, port: Number(url.port), timeoutMs: input.timeoutMs }, authorize); }
    return runIcmpProbe({ host: input.target, timeoutMs: input.timeoutMs }, authorize);
  }
  private async probe(job: EntityRow<"DurableJob">) {
    const monitor = await this.store.get("Monitor", job.ownerId);
    if (!monitor?.enabled) return;
    let result: ProbeResult;
    try { result = await this.perform(monitor); } catch { result = { ok: false, latencyMs: 0, errorCode: "CONFIG_INVALID", errorMessage: "Invalid credential or probe configuration" }; }
    const checkedAt = new Date().toISOString();
    const windows = await this.store.all("MaintenanceWindow");
    const suppressed = windows.some((window) => (!window.monitorId || window.monitorId === monitor.id) && maintenanceActive(window));
    await this.store.transaction(async (tx) => {
      if ((await tx.list("ProbeResult", { filters: [{ field: "sourceJobId", op: "eq", value: job.id }], limit: 1 })).length) return;
      const current = await tx.get("Monitor", monitor.id);
      if (!current?.enabled) return;
      const next = advanceMonitorState({ status: current.status, consecutiveFailures: current.consecutiveFailures, consecutiveSuccesses: current.consecutiveSuccesses }, result.ok, { failures: current.failureThreshold, successes: current.recoveryThreshold });
      await tx.put("ProbeResult", { sourceJobId: job.id, monitorId: current.id, ...result, maintenanceSuppressed: suppressed, checkedAt });
      await tx.put("Monitor", { ...current, status: next.state.status, consecutiveFailures: next.state.consecutiveFailures, consecutiveSuccesses: next.state.consecutiveSuccesses, lastCheckedAt: checkedAt, lastLatencyMs: result.latencyMs });
      if (!suppressed) {
        const day = `${checkedAt.slice(0, 10)}T00:00:00.000Z`;
        const metric = await tx.get("StatusDailyMetric", { monitorId: current.id, day });
        await tx.put("StatusDailyMetric", { monitorId: current.id, day, successCount: (metric?.successCount ?? 0) + (result.ok ? 1 : 0), failureCount: (metric?.failureCount ?? 0) + (result.ok ? 0 : 1) });
      }
      const incident = (await tx.list("Incident", { filters: [{ field: "monitorId", op: "eq", value: current.id }, { field: "status", op: "ne", value: "RESOLVED" }], limit: 1 }))[0];
      let transition: "DOWN" | "RECOVERY" | null = null; let incidentId: string | null = null;
      if (!suppressed && next.state.status === "DOWN" && !incident) {
        const created = await tx.put("Incident", { monitorId: current.id, title: `${current.name} is unavailable` }); incidentId = created.id; transition = "DOWN";
      } else if (next.transition === "RECOVERY" && incident) {
        await tx.put("Incident", { ...incident, status: "RESOLVED", resolvedAt: checkedAt }, incident.version);
        for (const approval of await tx.list("Approval", { filters: [{ field: "incidentId", op: "eq", value: incident.id }, { field: "status", op: "eq", value: "PENDING" }] })) await tx.put("Approval", { ...approval, status: "CANCELLED", decidedAt: checkedAt });
        incidentId = incident.id; transition = "RECOVERY";
      }
      if (transition && incidentId) for (const workflow of await tx.list("Workflow", { filters: [{ field: "monitorId", op: "eq", value: current.id }, { field: "enabled", op: "eq", value: true }, { field: "trigger", op: "eq", value: transition }] })) {
        if (transition === "DOWN" && workflow.approvalMode === "APPROVAL") await tx.put("Approval", { workflowId: workflow.id, incidentId, expiresAt: new Date(Date.now() + workflow.approvalTimeoutMinutes * 60000).toISOString() });
        else await this.enqueueWorkflow(tx, workflow, incidentId, transition, `${incidentId}:${transition}:${workflow.id}`);
      }
    });
    const saved = await this.store.get("Monitor", monitor.id);
    this.events.emit("event", { type: "monitor.updated", data: { monitorId: monitor.id, status: saved?.status, result } });
  }
  private async workflow(id: string) {
    const run = await this.store.get("WorkflowRun", id);
    if (!run || run.status !== "PENDING") return;
    const workflow = await this.store.get("Workflow", run.workflowId);
    if (!workflow) return;
    const monitor = workflow.monitorId ? await this.store.get("Monitor", workflow.monitorId) : null;
    await this.store.transaction((tx) => tx.put("WorkflowRun", { ...run, status: "RUNNING", startedAt: new Date().toISOString() }));
    let status: EntityRow<"WorkflowRun">["status"] = "SUCCEEDED";
    const steps = await this.store.list("WorkflowStep", { filters: [{ field: "workflowId", op: "eq", value: workflow.id }], order: [{ field: "position", direction: "asc" }], limit: 1000 });
    try {
      for (const step of steps) {
        await this.assertOwner();
        let result: ExecutionResult = { status: "FAILED" };
        for (let attempt = 1; attempt <= step.retries + 1; attempt += 1) {
          await this.assertOwner();
          const stepRun = await this.store.transaction((tx) => tx.put("StepRun", { workflowRunId: run.id, workflowStepId: step.id, attempt, status: "RUNNING", startedAt: new Date().toISOString() }));
          const credential = step.credentialId ? await this.store.get("Credential", step.credentialId) : null;
          result = await executeAction(step, credential ? { type: credential.type, secret: decryptSecret(credential.encrypted as unknown as SecretEnvelope, this.key, credential.id) } : null,
            { monitor: { name: monitor?.name ?? "Manual", target: monitor?.target ?? "" }, incident: { id: run.incidentId ?? run.id }, event: { type: run.trigger } },
            { authorize: this.authorize.bind(this), agent: this.agentCommand });
          await this.store.transaction((tx) => tx.put("StepRun", { ...stepRun, status: result.status, output: result.output ?? null, errorMessage: result.error ?? null, finishedAt: new Date().toISOString() }));
          if (result.status !== "FAILED") break;
        }
        if (result.status !== "SUCCEEDED") { status = result.status; if (!step.continueOnFailure) break; }
      }
    } catch {
      status = "UNKNOWN";
      await this.store.transaction(async (tx) => {
        for (const step of await tx.list("StepRun", { filters: [{ field: "workflowRunId", op: "eq", value: run.id }, { field: "status", op: "eq", value: "RUNNING" }] })) await tx.put("StepRun", { ...step, status: "UNKNOWN", errorMessage: "Execution interrupted; remote result uncertain", finishedAt: new Date().toISOString() });
      });
    }
    await this.store.transaction(async (tx) => { const current = await tx.get("WorkflowRun", run.id); if (current) await tx.put("WorkflowRun", { ...current, status, finishedAt: new Date().toISOString() }); });
    this.events.emit("event", { type: "workflow.finished", data: { runId: run.id, status } });
  }
  private async cleanup() {
    const settings = await this.store.all("Setting");
    const values = new Map(settings.map((item) => [item.key, item.value]));
    const now = new Date().toISOString();
    await this.store.transaction(async (tx) => {
      for (const [entity, field, days] of [["ProbeResult", "checkedAt", Number(values.get("probeRetentionDays") ?? 90)], ["AuditEvent", "createdAt", Number(values.get("auditRetentionDays") ?? 365)], ["StatusDailyMetric", "day", 90], ["DurableJob", "finishedAt", 7]] as const) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        for (const row of await tx.list(entity, { filters: [{ field, op: "lt", value: cutoff }], limit: 500 })) await tx.remove(entity, row as unknown as Record<string, unknown>);
      }
      for (const approval of await tx.list("Approval", { filters: [{ field: "status", op: "eq", value: "PENDING" }, { field: "expiresAt", op: "lt", value: now }] })) await tx.put("Approval", { ...approval, status: "EXPIRED", decidedAt: now });
    });
  }
}
