import { Queue, Worker, type Job } from "bullmq";
import { CronExpressionParser } from "cron-parser";
import { Client as SshClient } from "ssh2";
import nodemailer from "nodemailer";
import { Agent, fetch } from "undici";
import { Redis } from "ioredis";
import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import { Prisma, PrismaClient, ApprovalMode, ApprovalStatus, CredentialType, IncidentStatus, MonitorType, RunStatus, StepType, TriggerType } from "@netsentinel/database";
import { monitorInputSchema, workflowStepInputSchema } from "@netsentinel/contracts";
import { advanceMonitorState, decryptSecret, isAddressAllowed, renderCommandTemplate, runHttpProbe, runIcmpProbe, runTcpProbe, runWebSocketProbe, type ProbeResult, type SecretEnvelope } from "@netsentinel/core";
import { probeJobId } from "./job-ids.js";
import { buildCredentialHeaders, materializeWebSocketCredential, type HttpCredentialType, type WebSocketCredentialType } from "./credential-headers.js";
import { buildSshConnectionConfig, materializeSshCredential, validateSshPrivateKey } from "./ssh-credentials.js";
import { statusMetricDelta } from "./status-metrics.js";

const connection = { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) };
const prisma = new PrismaClient();
const redis = new Redis(connection);
const publisher = new Redis(connection);
const probeQueue = new Queue("probe", { connection });
const workflowQueue = new Queue("workflow", { connection });
const masterKey = process.env.NETSENTINEL_MASTER_KEY ? Buffer.from(process.env.NETSENTINEL_MASTER_KEY, "base64") : Buffer.alloc(0);
if (masterKey.length !== 32) throw new Error("NETSENTINEL_MASTER_KEY must be a base64-encoded 32-byte key");

const publish = async (type: string, data: unknown) => publisher.publish("netsentinel:events", JSON.stringify({ type, data }));

async function authorizeHostname(hostname: string): Promise<boolean> {
  try {
    const settings = await prisma.setting.findMany({ where: { key: { in: ["egressAllow", "egressDeny"] } } });
    const rules = new Map(settings.map((setting) => [setting.key, Array.isArray(setting.value) ? setting.value.map(String) : []]));
    const allow = rules.get("egressAllow") ?? []; const deny = rules.get("egressDeny") ?? [];
    const matchesHost = (rule: string) => rule.startsWith("*.") ? hostname.endsWith(rule.slice(1)) : hostname === rule;
    if (deny.some((rule) => !rule.includes("/") && matchesHost(rule))) return false;
    const hostAllowed = allow.some((rule) => !rule.includes("/") && matchesHost(rule));
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => hostAllowed || isAddressAllowed(address, { allow: allow.filter((rule) => rule.includes("/")), deny: deny.filter((rule) => rule.includes("/")) }));
  } catch { return false; }
}

async function isInMaintenance(monitorId: string, now = new Date()): Promise<boolean> {
  const windows = await prisma.maintenanceWindow.findMany({ where: { enabled: true, OR: [{ monitorId }, { monitorId: null }] } });
  return windows.some((window) => {
    if (window.startsAt && window.endsAt && window.startsAt <= now && window.endsAt > now) return true;
    if (!window.cron || !window.durationMinutes) return false;
    try {
      const previous = CronExpressionParser.parse(window.cron, { currentDate: now, tz: window.timezone }).prev().toDate();
      return previous <= now && previous.getTime() + window.durationMinutes * 60_000 > now.getTime();
    } catch { return false; }
  });
}

type ProbeMonitor = Prisma.MonitorGetPayload<{ include: { credential: true } }>;

function credentialHeaders(credential: ProbeMonitor["credential"] | { id: string; type: CredentialType; encrypted: Prisma.JsonValue } | null): Record<string, string> {
  if (!credential) return {};
  const httpTypes = new Set<CredentialType>([CredentialType.HTTP_BEARER, CredentialType.HTTP_BASIC, CredentialType.HTTP_API_KEY]);
  if (!httpTypes.has(credential.type)) throw new Error("CONFIG_INVALID: incompatible HTTP credential");
  const secret = decryptSecret(credential.encrypted as unknown as SecretEnvelope, masterKey, credential.id);
  return buildCredentialHeaders(credential.type as HttpCredentialType, secret);
}

function webSocketCredential(
  url: string,
  credential: ProbeMonitor["credential"],
): { url: string; headers: Record<string, string> } {
  if (!credential) return { url, headers: {} };
  const compatibleTypes = new Set<CredentialType>([
    CredentialType.HTTP_BEARER,
    CredentialType.HTTP_BASIC,
    CredentialType.HTTP_API_KEY,
    CredentialType.WS_TOKEN,
  ]);
  if (!compatibleTypes.has(credential.type)) {
    throw new Error("CONFIG_INVALID: incompatible WebSocket credential");
  }
  const secret = decryptSecret(
    credential.encrypted as unknown as SecretEnvelope,
    masterKey,
    credential.id,
  );
  return materializeWebSocketCredential(
    url,
    credential.type as WebSocketCredentialType,
    secret,
  );
}

async function performProbe(monitor: ProbeMonitor): Promise<ProbeResult> {
  const parsed = monitorInputSchema.safeParse({
    name: monitor.name, type: monitor.type, target: monitor.target, credentialId: monitor.credentialId,
    intervalSeconds: monitor.intervalSeconds, timeoutMs: monitor.timeoutMs,
    failureThreshold: monitor.failureThreshold, recoveryThreshold: monitor.recoveryThreshold,
    tagIds: [], config: monitor.config,
  });
  if (!parsed.success) return { ok: false, latencyMs: 0, errorCode: "CONFIG_INVALID", errorMessage: "Monitor configuration is incomplete" };
  const input = parsed.data;
  let authHeaders: Record<string, string> = {};
  if (input.type === "HTTP") {
    try { authHeaders = credentialHeaders(monitor.credential); }
    catch { return { ok: false, latencyMs: 0, errorCode: "CONFIG_INVALID", errorMessage: "Monitor credential is missing or incompatible" }; }
  }
  switch (monitor.type) {
    case MonitorType.HTTP: {
      if (input.type !== "HTTP") throw new Error("CONFIG_INVALID");
      return runHttpProbe({
        url: input.target, method: input.config.method, timeoutMs: input.timeoutMs,
        expectedStatusMin: input.config.expectedStatusMin, expectedStatusMax: input.config.expectedStatusMax,
        verifyTls: input.config.verifyTls, headers: { ...input.config.headers, ...authHeaders },
        ...(input.config.body !== undefined ? { body: input.config.body } : {}),
        ...(input.config.maxLatencyMs !== undefined ? { maxLatencyMs: input.config.maxLatencyMs } : {}),
        ...(input.config.textContains !== undefined ? { textContains: input.config.textContains } : {}),
        ...(input.config.regex !== undefined ? { regex: input.config.regex } : {}),
        ...(input.config.jsonPath !== undefined ? { jsonPath: input.config.jsonPath, jsonPathExpected: input.config.jsonPathExpected } : {}),
      }, authorizeHostname);
    }
    case MonitorType.WEBSOCKET: {
      if (input.type !== "WEBSOCKET") throw new Error("CONFIG_INVALID");
      let materialized: { url: string; headers: Record<string, string> };
      try { materialized = webSocketCredential(input.target, monitor.credential); }
      catch { return { ok: false, latencyMs: 0, errorCode: "CONFIG_INVALID", errorMessage: "Monitor credential is missing or incompatible" }; }
      return runWebSocketProbe({ url: materialized.url, timeoutMs: input.timeoutMs, verifyTls: input.config.verifyTls, headers: { ...input.config.headers, ...materialized.headers }, expect: input.config.expect, ...(input.config.send !== undefined ? { send: input.config.send } : {}), ...(input.config.textContains !== undefined ? { textContains: input.config.textContains } : {}) }, authorizeHostname);
    }
    case MonitorType.TCP: {
      if (input.type !== "TCP") throw new Error("CONFIG_INVALID");
      const url = new URL(`tcp://${input.target}`);
      return runTcpProbe({ host: url.hostname, port: Number(url.port), timeoutMs: input.timeoutMs }, authorizeHostname);
    }
    case MonitorType.ICMP: {
      if (input.type !== "ICMP") throw new Error("CONFIG_INVALID");
      return runIcmpProbe({ host: input.target, timeoutMs: input.timeoutMs }, authorizeHostname);
    }
  }
}

async function createWorkflowEffects(monitorId: string, incidentId: string, trigger: TriggerType) {
  const workflows = await prisma.workflow.findMany({ where: { monitorId, trigger, enabled: true } });
  const runIds: string[] = [];
  for (const workflow of workflows) {
    if (workflow.approvalMode === ApprovalMode.APPROVAL && trigger === TriggerType.DOWN) {
      await prisma.approval.create({ data: { workflowId: workflow.id, incidentId, expiresAt: new Date(Date.now() + workflow.approvalTimeoutMinutes * 60_000) } });
    } else {
      const run = await prisma.workflowRun.upsert({ where: { idempotencyKey: `${incidentId}:${trigger}:${workflow.id}` }, create: { workflowId: workflow.id, incidentId, trigger, idempotencyKey: `${incidentId}:${trigger}:${workflow.id}` }, update: {} });
      runIds.push(run.id);
    }
  }
  await Promise.all(runIds.map((runId) => workflowQueue.add("execute", { runId }, { jobId: runId })));
}

async function handleProbe(job: Job<{ monitorId: string }>): Promise<void> {
  const monitor = await prisma.monitor.findUnique({ where: { id: job.data.monitorId }, include: { credential: true } });
  if (!monitor || !monitor.enabled) return;
  const result = await performProbe(monitor);
  const next = advanceMonitorState({ status: monitor.status, consecutiveFailures: monitor.consecutiveFailures, consecutiveSuccesses: monitor.consecutiveSuccesses }, result.ok, { failures: monitor.failureThreshold, successes: monitor.recoveryThreshold });
  const maintenance = await isInMaintenance(monitor.id);
  const checkedAt = new Date();
  const metric = statusMetricDelta(result.ok, maintenance, checkedAt);
  let effects: { downIncidentId: string | null; recoveredIncidentId: string | null };
  try {
    effects = await prisma.$transaction(async (tx) => {
      await tx.probeResult.create({ data: { sourceJobId: job.id, monitorId: monitor.id, ok: result.ok, latencyMs: result.latencyMs, statusCode: result.statusCode, errorCode: result.errorCode, errorMessage: result.errorMessage, maintenanceSuppressed: maintenance, checkedAt } });
      if (metric) {
        await tx.statusDailyMetric.upsert({
          where: { monitorId_day: { monitorId: monitor.id, day: metric.day } },
          create: { monitorId: monitor.id, day: metric.day, successCount: metric.successCount, failureCount: metric.failureCount },
          update: { successCount: { increment: metric.successCount }, failureCount: { increment: metric.failureCount } },
        });
      }
      await tx.monitor.update({ where: { id: monitor.id }, data: { status: next.state.status, consecutiveFailures: next.state.consecutiveFailures, consecutiveSuccesses: next.state.consecutiveSuccesses, lastCheckedAt: checkedAt, lastLatencyMs: result.latencyMs } });
      const active = await tx.incident.findFirst({ where: { monitorId: monitor.id, status: { not: IncidentStatus.RESOLVED } }, orderBy: { openedAt: "desc" } });
      if (!maintenance && next.state.status === "DOWN" && !active) {
        const incident = await tx.incident.create({ data: { monitorId: monitor.id, title: `${monitor.name} is unavailable` } });
        return { downIncidentId: incident.id, recoveredIncidentId: null };
      }
      if (next.transition === "RECOVERY" && active) {
        await tx.incident.update({ where: { id: active.id }, data: { status: IncidentStatus.RESOLVED, resolvedAt: checkedAt, version: { increment: 1 } } });
        await tx.approval.updateMany({ where: { incidentId: active.id, status: ApprovalStatus.PENDING }, data: { status: ApprovalStatus.CANCELLED, decidedAt: checkedAt } });
        return { downIncidentId: null, recoveredIncidentId: active.id };
      }
      return { downIncidentId: null, recoveredIncidentId: null };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
  if (effects.downIncidentId) await createWorkflowEffects(monitor.id, effects.downIncidentId, TriggerType.DOWN);
  if (effects.recoveredIncidentId) await createWorkflowEffects(monitor.id, effects.recoveredIncidentId, TriggerType.RECOVERY);
  await publish("monitor.updated", { monitorId: monitor.id, status: next.state.status, result });
}

interface ActionResult { status: RunStatus; output?: string; error?: string }
const cap = (value: string) => value.slice(-64 * 1024);
const redact = (value: string, secrets: string[]) => secrets.reduce((text, secret) => secret ? text.replaceAll(secret, "[REDACTED]") : text, value);

async function runProcess(command: string, timeoutMs: number): Promise<ActionResult> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", command], { shell: false, env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" } });
    let output = ""; let settled = false;
    const finish = (result: ActionResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ status: RunStatus.UNKNOWN, error: "Command timed out; remote effects may be unknown" }); }, timeoutMs);
    child.stdout.on("data", (data: Buffer) => { output = cap(output + data.toString("utf8")); });
    child.stderr.on("data", (data: Buffer) => { output = cap(output + data.toString("utf8")); });
    child.once("error", () => finish({ status: RunStatus.FAILED, error: "Command could not be started" }));
    child.once("close", (code) => finish(code === 0 ? { status: RunStatus.SUCCEEDED, output } : { status: RunStatus.FAILED, output, error: `Command exited with ${code}` }));
  });
}

async function runSsh(config: Record<string, unknown>, credentialType: CredentialType | null, secret: string, command: string, timeoutMs: number): Promise<ActionResult> {
  let authentication;
  try {
    authentication = materializeSshCredential(String(credentialType), secret);
    if ("privateKey" in authentication) {
      validateSshPrivateKey(authentication.privateKey, authentication.passphrase);
    }
  } catch {
    return { status: RunStatus.FAILED, error: "CONFIG_INVALID: SSH private key or passphrase is invalid" };
  }
  return new Promise((resolve) => {
    const client = new SshClient(); let output = ""; let settled = false;
    const finish = (result: ActionResult) => { if (!settled) { settled = true; clearTimeout(timer); client.end(); resolve(result); } };
    const timer = setTimeout(() => finish({ status: RunStatus.UNKNOWN, error: "SSH timed out; remote effects may be unknown" }), timeoutMs);
    client.on("ready", () => client.exec(command, (error, stream) => {
      if (error) return finish({ status: RunStatus.FAILED, error: "SSH command could not start" });
      stream.on("data", (data: Buffer) => { output = cap(output + data.toString("utf8")); });
      stream.stderr.on("data", (data: Buffer) => { output = cap(output + data.toString("utf8")); });
      stream.on("close", (code: number) => finish(code === 0 ? { status: RunStatus.SUCCEEDED, output } : { status: RunStatus.FAILED, output, error: `SSH exited with ${code}` }));
    }));
    client.on("error", () => finish({ status: RunStatus.FAILED, error: "SSH connection failed" }));
    try {
      client.connect(buildSshConnectionConfig(config as { host: unknown; port?: unknown; username: unknown }, authentication, timeoutMs));
    } catch {
      finish({ status: RunStatus.FAILED, error: "CONFIG_INVALID: SSH connection settings are invalid" });
    }
  });
}

async function runHttpAction(config: Record<string, unknown>, headers: Record<string, string>, idempotencyKey: string, timeoutMs: number): Promise<ActionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = config.verifyTls === false ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  let url = String(config.url);
  let method = String(config.method ?? "POST");
  let body = typeof config.body === "string" ? config.body : undefined;
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const target = new URL(url);
      if (!["http:", "https:"].includes(target.protocol) || !await authorizeHostname(target.hostname)) return { status: RunStatus.FAILED, error: "EGRESS_BLOCKED: target is not allowed" };
      const response = await fetch(target, {
        method, headers: { ...headers, "idempotency-key": idempotencyKey },
        ...(method !== "GET" && method !== "HEAD" && body !== undefined ? { body } : {}),
        redirect: "manual", signal: controller.signal, ...(dispatcher ? { dispatcher } : {}),
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        if (redirects === 5) return { status: RunStatus.FAILED, error: "Too many redirects" };
        url = new URL(response.headers.get("location")!, target).toString();
        if ([301, 302, 303].includes(response.status) && method !== "GET" && method !== "HEAD") { method = "GET"; body = undefined; }
        continue;
      }
      return response.ok ? { status: RunStatus.SUCCEEDED, output: `HTTP ${response.status}` } : { status: RunStatus.FAILED, error: `HTTP ${response.status}` };
    }
    return { status: RunStatus.FAILED, error: "Too many redirects" };
  } catch (error) {
    return controller.signal.aborted ? { status: RunStatus.UNKNOWN, error: "HTTP timed out; remote effects may be unknown" } : { status: RunStatus.UNKNOWN, error: "HTTP result is unknown" };
  } finally {
    clearTimeout(timer);
    await dispatcher?.close();
  }
}

async function runAgent(config: Record<string, unknown>, command: string, timeoutMs: number): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  return new Promise(async (resolve) => {
    const listener = redis.duplicate();
    const timer = setTimeout(async () => { await listener.quit(); resolve({ status: RunStatus.UNKNOWN, error: "Agent response timed out" }); }, timeoutMs + 1_000);
    listener.once("message", async (_channel: string, message: string) => { clearTimeout(timer); await listener.quit(); resolve(JSON.parse(message) as ActionResult); });
    await listener.subscribe(`netsentinel:agent:results:${requestId}`);
    await publisher.publish(`netsentinel:agent:commands:${String(config.agentId)}`, JSON.stringify({ requestId, command, timeoutMs }));
  });
}

async function executeStep(step: { name: string; type: StepType; config: Prisma.JsonValue; timeoutMs: number; retries: number; continueOnFailure: boolean; credentialId: string | null; credential: { id: string; type: CredentialType; encrypted: Prisma.JsonValue } | null }, context: Parameters<typeof renderCommandTemplate>[1]): Promise<ActionResult> {
  const validation = workflowStepInputSchema.safeParse({ name: step.name, type: step.type, config: step.config, timeoutMs: step.timeoutMs, retries: step.retries, continueOnFailure: step.continueOnFailure, credentialId: step.credentialId });
  if (!validation.success) return { status: RunStatus.FAILED, error: "CONFIG_INVALID: workflow step configuration is incomplete" };
  const httpTypes = new Set<CredentialType>([CredentialType.HTTP_BEARER, CredentialType.HTTP_BASIC, CredentialType.HTTP_API_KEY]);
  const sshTypes = new Set<CredentialType>([CredentialType.SSH_KEY, CredentialType.SSH_PASSWORD]);
  if ((step.type === StepType.HTTP || step.type === StepType.WEBHOOK) && step.credential && !httpTypes.has(step.credential.type)) return { status: RunStatus.FAILED, error: "CONFIG_INVALID: incompatible HTTP credential" };
  if (step.type === StepType.SSH && step.credential && !sshTypes.has(step.credential.type)) return { status: RunStatus.FAILED, error: "CONFIG_INVALID: incompatible SSH credential" };
  if (step.type === StepType.EMAIL && step.credential?.type !== CredentialType.SMTP) return { status: RunStatus.FAILED, error: "CONFIG_INVALID: SMTP credential is required" };
  const config = step.config as Record<string, unknown>;
  const secret = step.credential ? decryptSecret(step.credential.encrypted as unknown as SecretEnvelope, masterKey, step.credential.id) : "";
  let result: ActionResult;
  if (step.type === StepType.SHELL) result = await runProcess(renderCommandTemplate(String(config.command), context), step.timeoutMs);
  else if (step.type === StepType.AGENT_SHELL) result = await runAgent(config, renderCommandTemplate(String(config.command), context), step.timeoutMs);
  else if (step.type === StepType.SSH) result = await runSsh(config, step.credential?.type ?? null, secret, renderCommandTemplate(String(config.command), context), step.timeoutMs);
  else if (step.type === StepType.HTTP || step.type === StepType.WEBHOOK) {
    const plainHeaders = typeof config.headers === "object" && config.headers ? config.headers as Record<string, string> : {};
    result = await runHttpAction(config, { ...plainHeaders, ...credentialHeaders(step.credential) }, context.incident.id, step.timeoutMs);
  } else {
    try { const smtp = JSON.parse(secret) as { host: string; port: number; secure?: boolean; user: string; password: string; from: string }; const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure ?? false, auth: { user: smtp.user, pass: smtp.password } }); await transport.sendMail({ from: smtp.from, to: String(config.to), subject: String(config.subject), text: String(config.body) }); result = { status: RunStatus.SUCCEEDED, output: "Email accepted by SMTP server" }; }
    catch { result = { status: RunStatus.FAILED, error: "Email delivery failed" }; }
  }
  return { ...result, ...(result.output ? { output: redact(result.output, [secret]) } : {}), ...(result.error ? { error: redact(result.error, [secret]) } : {}) };
}

async function handleWorkflow(job: Job<{ runId: string }>): Promise<void> {
  const run = await prisma.workflowRun.findUnique({ where: { id: job.data.runId }, include: { workflow: { include: { monitor: true, steps: { orderBy: { position: "asc" }, include: { credential: true } } } }, incident: true } });
  if (!run) return;
  if (run.status === RunStatus.RUNNING) {
    await prisma.$transaction([
      prisma.stepRun.updateMany({ where: { workflowRunId: run.id, status: RunStatus.RUNNING }, data: { status: RunStatus.UNKNOWN, errorMessage: "Worker restarted while the remote result was uncertain", finishedAt: new Date() } }),
      prisma.workflowRun.update({ where: { id: run.id }, data: { status: RunStatus.UNKNOWN, finishedAt: new Date() } }),
    ]);
    await publish("workflow.finished", { runId: run.id, status: RunStatus.UNKNOWN });
    return;
  }
  if (run.status !== RunStatus.PENDING) return;
  await prisma.workflowRun.update({ where: { id: run.id }, data: { status: RunStatus.RUNNING, startedAt: new Date() } });
  try {
    let finalStatus: RunStatus = RunStatus.SUCCEEDED;
    const context = { monitor: { name: run.workflow.monitor?.name ?? "Manual", target: run.workflow.monitor?.target ?? "" }, incident: { id: run.incidentId ?? run.id }, event: { type: run.trigger } };
    for (const step of run.workflow.steps) {
      let result: ActionResult = { status: RunStatus.FAILED, error: "Not executed" };
      for (let attempt = 1; attempt <= step.retries + 1; attempt += 1) {
        const stepRun = await prisma.stepRun.create({ data: { workflowRunId: run.id, workflowStepId: step.id, attempt, status: RunStatus.RUNNING, startedAt: new Date() } });
        try {
          result = await executeStep(step, context);
        } catch {
          result = { status: RunStatus.UNKNOWN, error: "Unexpected action error; the remote result may be unknown" };
        }
        await prisma.stepRun.update({ where: { id: stepRun.id }, data: { status: result.status, output: result.output, errorMessage: result.error, finishedAt: new Date() } });
        if (result.status === RunStatus.SUCCEEDED || result.status === RunStatus.UNKNOWN) break;
      }
      if (result.status !== RunStatus.SUCCEEDED) { finalStatus = result.status; if (!step.continueOnFailure) break; }
    }
    await prisma.workflowRun.update({ where: { id: run.id }, data: { status: finalStatus, finishedAt: new Date() } });
    await publish("workflow.finished", { runId: run.id, status: finalStatus });
  } catch {
    await prisma.$transaction([
      prisma.stepRun.updateMany({ where: { workflowRunId: run.id, status: RunStatus.RUNNING }, data: { status: RunStatus.UNKNOWN, errorMessage: "Unexpected workflow error; the remote result may be unknown", finishedAt: new Date() } }),
      prisma.workflowRun.update({ where: { id: run.id }, data: { status: RunStatus.UNKNOWN, finishedAt: new Date() } }),
    ]);
    await publish("workflow.finished", { runId: run.id, status: RunStatus.UNKNOWN });
  }
}

async function scheduleDueMonitors(): Promise<void> {
  const now = new Date();
  const monitors = await prisma.monitor.findMany({ where: { enabled: true, nextCheckAt: { lte: now } }, take: 100 });
  for (const monitor of monitors) {
    const nextCheckAt = new Date(now.getTime() + monitor.intervalSeconds * 1_000);
    const claimed = await prisma.monitor.updateMany({ where: { id: monitor.id, nextCheckAt: monitor.nextCheckAt }, data: { nextCheckAt } });
    if (claimed.count) await probeQueue.add("check", { monitorId: monitor.id }, { jobId: probeJobId(monitor.id, monitor.nextCheckAt), removeOnComplete: 1_000, removeOnFail: 1_000 });
  }
}

async function cleanupRetention(): Promise<void> {
  const settings = await prisma.setting.findMany({ where: { key: { in: ["probeRetentionDays", "auditRetentionDays"] } } });
  const values = new Map(settings.map((setting) => [setting.key, Number(setting.value)]));
  const probeCutoff = new Date(Date.now() - (values.get("probeRetentionDays") ?? 90) * 86_400_000);
  const auditCutoff = new Date(Date.now() - (values.get("auditRetentionDays") ?? 365) * 86_400_000);
  const statusCutoff = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 90));
  await prisma.$transaction([
    prisma.probeResult.deleteMany({ where: { checkedAt: { lt: probeCutoff } } }),
    prisma.statusDailyMetric.deleteMany({ where: { day: { lt: statusCutoff } } }),
    prisma.auditEvent.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
  ]);
  await prisma.approval.updateMany({ where: { status: ApprovalStatus.PENDING, expiresAt: { lt: new Date() } }, data: { status: ApprovalStatus.EXPIRED, decidedAt: new Date() } });
}

const probeWorker = new Worker("probe", handleProbe, { connection, concurrency: 20, lockDuration: 300_000 });
const workflowWorker = new Worker("workflow", handleWorkflow, { connection, concurrency: 5, lockDuration: 600_000 });
const scheduleTimer = setInterval(() => void scheduleDueMonitors(), 5_000);
const cleanupTimer = setInterval(() => void cleanupRetention(), 24 * 60 * 60 * 1_000);
void scheduleDueMonitors(); void cleanupRetention();

async function shutdown(): Promise<void> {
  clearInterval(scheduleTimer); clearInterval(cleanupTimer);
  await Promise.all([probeWorker.close(), workflowWorker.close(), probeQueue.close(), workflowQueue.close(), redis.quit(), publisher.quit(), prisma.$disconnect()]);
}
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
