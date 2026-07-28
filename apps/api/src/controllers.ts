import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Header, Inject, MessageEvent, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, Sse } from "@nestjs/common";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import { map, type Observable } from "rxjs";
import { z } from "zod";
import { PERMISSIONS, credentialInputSchema, monitorInputSchema, workflowInputSchema, type CredentialInput, type Permission, type WorkflowRunSummary } from "@netsentinel/contracts";
import { encryptSecret } from "@netsentinel/core";
import { ApprovalStatus, CredentialType, IncidentStatus, MonitorStatus, Prisma, RunStatus, TriggerType } from "@netsentinel/database";
import { AuthService, Public, RequirePermissions, type AuthenticatedRequest, digest, hashPassword } from "./auth.js";
import { PrismaService } from "./prisma.service.js";
import { EventStreamService, QueueService, metrics } from "./services.js";

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ detail: "Validation failed", errors: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message, code: issue.code })) });
  return result.data;
};

async function getWorkflowRunSummary(prisma: PrismaService, id: string): Promise<WorkflowRunSummary> {
  const run = await prisma.workflowRun.findUnique({
    where: { id },
    include: {
      workflow: { select: { id: true, name: true } },
      steps: {
        include: { workflowStep: { select: { name: true, position: true } } },
        orderBy: [{ workflowStep: { position: "asc" } }, { attempt: "asc" }],
      },
    },
  });
  if (!run) throw new NotFoundException("Workflow run not found");
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflow: run.workflow,
    status: run.status,
    trigger: run.trigger,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    steps: run.steps.map((step) => ({
      id: step.id,
      name: step.workflowStep.name,
      position: step.workflowStep.position,
      attempt: step.attempt,
      status: step.status,
    })),
  };
}

const masterKey = () => Buffer.from(process.env.NETSENTINEL_MASTER_KEY!, "base64");
const credentialSecret = (input: CredentialInput): string => {
  if (input.type === "SSH_KEY") return JSON.stringify({ privateKey: input.secret, ...(input.passphrase ? { passphrase: input.passphrase } : {}) });
  if (input.type === "HTTP_BASIC") return JSON.stringify({ username: input.username, password: input.password });
  if (input.type === "HTTP_API_KEY") return JSON.stringify({ headerName: input.headerName, value: input.value });
  if (input.type === "WS_TOKEN") return JSON.stringify({ token: input.token, placement: input.placement, queryParamName: input.queryParamName });
  if (input.type === "SMTP") return JSON.stringify({ host: input.host, port: input.port, secure: input.secure, user: input.user, password: input.password, from: input.from });
  return input.secret;
};
const compatibleCredentialTypes = (ownerType: string): CredentialType[] => {
  if (ownerType === "WEBSOCKET") return [CredentialType.HTTP_BEARER, CredentialType.HTTP_BASIC, CredentialType.HTTP_API_KEY, CredentialType.WS_TOKEN];
  if (["HTTP", "WEBHOOK"].includes(ownerType)) return [CredentialType.HTTP_BEARER, CredentialType.HTTP_BASIC, CredentialType.HTTP_API_KEY];
  if (ownerType === "SSH") return [CredentialType.SSH_KEY, CredentialType.SSH_PASSWORD];
  if (ownerType === "EMAIL") return [CredentialType.SMTP];
  return [];
};
async function assertCredential(prisma: PrismaService, credentialId: string | null | undefined, ownerType: string): Promise<void> {
  if (!credentialId) return;
  const credential = await prisma.credential.findUnique({ where: { id: credentialId }, select: { type: true } });
  if (!credential) throw new BadRequestException({ detail: "Credential does not exist", errors: [{ path: "credentialId", message: "Credential does not exist", code: "custom" }] });
  if (!compatibleCredentialTypes(ownerType).includes(credential.type)) throw new BadRequestException({ detail: "Credential type is incompatible", errors: [{ path: "credentialId", message: `Credential type ${credential.type} cannot be used by ${ownerType}`, code: "custom" }] });
}
const maintenanceInputSchema = z.object({ name: z.string().trim().min(1).max(120), monitorId: z.string().nullable().optional(), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), cron: z.string().trim().min(1).optional(), durationMinutes: z.number().int().positive().max(525_600).optional(), timezone: z.string().min(1).default("UTC"), enabled: z.boolean().default(true) }).superRefine((value, context) => {
  const recurring = Boolean(value.cron);
  if (recurring && !value.durationMinutes) context.addIssue({ code: "custom", path: ["durationMinutes"], message: "Duration is required for a recurring window" });
  if (!recurring && (!value.startsAt || !value.endsAt)) context.addIssue({ code: "custom", path: ["startsAt"], message: "Start and end are required for a one-time window" });
  if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt) context.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
});

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Public() @Post("login")
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = parse(z.object({ email: z.string().email(), password: z.string().min(8) }), body);
    const result = await this.auth.login(input.email, input.password);
    response.cookie("netsentinel_session", result.session, { httpOnly: true, secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false", sameSite: "lax", maxAge: 8 * 60 * 60 * 1_000, path: "/" });
    return { user: result.principal, csrfToken: result.csrf };
  }
  @Post("logout") async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.netsentinel_session as string | undefined);
    response.clearCookie("netsentinel_session", { path: "/" });
    return { ok: true };
  }
  @Get("me") me(@Req() request: AuthenticatedRequest) { return { user: request.principal }; }
}

@Controller()
export class SystemController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(EventStreamService) private readonly stream: EventStreamService, @Inject(QueueService) private readonly queues: QueueService) {}
  @Public() @Get("health/live") live() { return { status: "ok" }; }
  @Public() @Get("health/ready") async ready() {
    const [, workers] = await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.queues.probe.getWorkers()]);
    return { status: "ready", workerConnected: workers.length > 0 };
  }
  @Public() @Get("metrics") @Header("content-type", "text/plain; version=0.0.4") getMetrics() { return metrics(); }
  @Sse("events") events(): Observable<MessageEvent> { return this.stream.events.pipe(map((event) => ({ type: event.type, data: event.data as object }))); }
}

@Controller("dashboard")
@RequirePermissions("monitor:read")
export class DashboardController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() async get() {
    const now = Date.now();
    const last24Hours = new Date(now - 24 * 60 * 60 * 1_000);
    const last12Hours = new Date(now - 12 * 60 * 60 * 1_000);
    const [monitors, openIncidents, pendingApprovals, totalResults, goodResults, latencyRows] = await Promise.all([
      this.prisma.monitor.findMany({ include: { tags: { include: { tag: true } } }, orderBy: { name: "asc" } }),
      this.prisma.incident.count({ where: { status: { not: IncidentStatus.RESOLVED } } }),
      this.prisma.approval.count({ where: { status: ApprovalStatus.PENDING, expiresAt: { gt: new Date() } } }),
      this.prisma.probeResult.count({ where: { checkedAt: { gte: last24Hours } } }),
      this.prisma.probeResult.count({ where: { ok: true, checkedAt: { gte: last24Hours } } }),
      this.prisma.$queryRaw<Array<{ bucket: Date; p50Ms: number }>>`
        SELECT
          date_trunc('hour', "checkedAt") AS "bucket",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS "p50Ms"
        FROM "ProbeResult"
        WHERE "checkedAt" >= ${last12Hours}
          AND "latencyMs" IS NOT NULL
        GROUP BY date_trunc('hour', "checkedAt")
        ORDER BY "bucket" ASC
      `,
    ]);
    return {
      monitors: monitors.map((monitor) => ({ id: monitor.id, name: monitor.name, type: monitor.type, target: monitor.target, status: monitor.status, latencyMs: monitor.lastLatencyMs, lastCheckedAt: monitor.lastCheckedAt?.toISOString() ?? null, tags: monitor.tags.map(({ tag }) => tag.name) })),
      openIncidents,
      pendingApprovals,
      uptimePercent: totalResults ? Number(((goodResults / totalResults) * 100).toFixed(2)) : null,
      probeResults24h: totalResults,
      latencyTrend: latencyRows.map((row) => ({
        bucket: row.bucket.toISOString(),
        p50Ms: Number(row.p50Ms),
      })),
    };
  }
}

const runtimeLogQuerySchema = z.object({
  source: z.enum(["ALL", "PROBE", "ACTION"]).default("ALL"),
  status: z.enum(["ALL", "SUCCESS", "FAILURE", "IN_PROGRESS", "UNKNOWN"]).default("ALL"),
  monitorId: z.string().trim().optional(),
  runId: z.string().trim().optional(),
  search: z.string().trim().max(200).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(10).max(100).default(50),
});

const truncateLogText = (value: string | null | undefined) => {
  if (!value) return null;
  return value.length > 16_000 ? `${value.slice(0, 16_000)}\n…输出已截断` : value;
};

@Controller("logs")
export class RuntimeLogsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    const input = parse(runtimeLogQuerySchema, query);
    const permissions = new Set(request.principal!.permissions);
    const canReadProbes = permissions.has("monitor:read");
    const canReadActions = permissions.has("workflow:read");
    if (
      (!canReadProbes && !canReadActions) ||
      (input.source === "PROBE" && !canReadProbes) ||
      (input.source === "ACTION" && !canReadActions)
    ) {
      throw new ForbiddenException("Missing permission for the requested log source");
    }

    const before = input.cursor ? new Date(input.cursor) : undefined;
    const take = input.limit + 1;
    const includeProbes =
      canReadProbes &&
      !input.runId &&
      input.source !== "ACTION" &&
      !["IN_PROGRESS", "UNKNOWN"].includes(input.status);
    const includeActions = canReadActions && input.source !== "PROBE";

    const probeWhere: Prisma.ProbeResultWhereInput = {
      ...(before ? { checkedAt: { lt: before } } : {}),
      ...(input.monitorId ? { monitorId: input.monitorId } : {}),
      ...(input.status === "SUCCESS" ? { ok: true } : {}),
      ...(input.status === "FAILURE" ? { ok: false } : {}),
      ...(input.search
        ? {
            OR: [
              { monitor: { name: { contains: input.search, mode: "insensitive" } } },
              { monitor: { target: { contains: input.search, mode: "insensitive" } } },
              { errorCode: { contains: input.search, mode: "insensitive" } },
              { errorMessage: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const actionStatuses =
      input.status === "SUCCESS"
        ? [RunStatus.SUCCEEDED]
        : input.status === "FAILURE"
          ? [RunStatus.FAILED, RunStatus.CANCELLED]
          : input.status === "IN_PROGRESS"
            ? [RunStatus.PENDING, RunStatus.RUNNING]
            : input.status === "UNKNOWN"
              ? [RunStatus.UNKNOWN]
              : undefined;
    const actionWhere: Prisma.WorkflowRunWhereInput = {
      ...(input.runId ? { id: input.runId } : {}),
      ...(before ? { createdAt: { lt: before } } : {}),
      ...(actionStatuses ? { status: { in: actionStatuses } } : {}),
      ...(input.monitorId ? { workflow: { monitorId: input.monitorId } } : {}),
      ...(input.search
        ? {
            OR: [
              { workflow: { name: { contains: input.search, mode: "insensitive" } } },
              { workflow: { monitor: { name: { contains: input.search, mode: "insensitive" } } } },
              {
                steps: {
                  some: {
                    OR: [
                      { output: { contains: input.search, mode: "insensitive" } },
                      { errorMessage: { contains: input.search, mode: "insensitive" } },
                      { workflowStep: { name: { contains: input.search, mode: "insensitive" } } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [probes, actions] = await Promise.all([
      includeProbes
        ? this.prisma.probeResult.findMany({
            where: probeWhere,
            include: { monitor: { select: { id: true, name: true, target: true, type: true } } },
            orderBy: { checkedAt: "desc" },
            take,
          })
        : [],
      includeActions
        ? this.prisma.workflowRun.findMany({
            where: actionWhere,
            include: {
              workflow: { select: { id: true, name: true, monitor: { select: { id: true, name: true } } } },
              steps: {
                include: { workflowStep: { select: { name: true, type: true, position: true } } },
              },
            },
            orderBy: { createdAt: "desc" },
            take,
          })
        : [],
    ]);

    const probeItems = probes.map((item) => ({
      id: `probe:${item.id}`,
      source: "PROBE" as const,
      status: item.ok ? ("SUCCESS" as const) : ("FAILURE" as const),
      timestamp: item.checkedAt.toISOString(),
      title: item.ok ? "探测成功" : "探测失败",
      summary: item.ok
        ? `${item.monitor.type} 响应正常`
        : item.errorMessage ?? item.errorCode ?? `${item.monitor.type} 探测失败`,
      monitor: item.monitor,
      durationMs: item.latencyMs,
      details: {
        statusCode: item.statusCode,
        errorCode: item.errorCode,
        errorMessage: truncateLogText(item.errorMessage),
      },
    }));
    const actionItems = actions.map((item) => ({
      id: `action:${item.id}`,
      source: "ACTION" as const,
      status:
        item.status === RunStatus.SUCCEEDED
          ? ("SUCCESS" as const)
          : item.status === RunStatus.FAILED || item.status === RunStatus.CANCELLED
            ? ("FAILURE" as const)
            : item.status === RunStatus.PENDING || item.status === RunStatus.RUNNING
              ? ("IN_PROGRESS" as const)
              : ("UNKNOWN" as const),
      timestamp: item.createdAt.toISOString(),
      title: item.workflow.name,
      summary: `工作流执行 · ${item.trigger}`,
      monitor: item.workflow.monitor,
      durationMs:
        item.startedAt && item.finishedAt
          ? Math.max(0, item.finishedAt.getTime() - item.startedAt.getTime())
          : null,
      details: {
        runId: item.id,
        trigger: item.trigger,
        runStatus: item.status,
        startedAt: item.startedAt?.toISOString() ?? null,
        finishedAt: item.finishedAt?.toISOString() ?? null,
        steps: item.steps
          .sort(
            (left, right) =>
              left.workflowStep.position - right.workflowStep.position ||
              left.attempt - right.attempt,
          )
          .map((step) => ({
            id: step.id,
            name: step.workflowStep.name,
            type: step.workflowStep.type,
            attempt: step.attempt,
            status: step.status,
            durationMs:
              step.startedAt && step.finishedAt
                ? Math.max(0, step.finishedAt.getTime() - step.startedAt.getTime())
                : null,
            output: truncateLogText(step.output),
            errorMessage: truncateLogText(step.errorMessage),
          })),
      },
    }));
    const merged = [...probeItems, ...actionItems].sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime() ||
        right.id.localeCompare(left.id),
    );
    const items = merged.slice(0, input.limit);
    return {
      items,
      nextCursor:
        merged.length > input.limit ? items.at(-1)?.timestamp ?? null : null,
    };
  }
}

@Controller("monitors")
export class MonitorsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(QueueService) private readonly queues: QueueService) {}
  @Get() @RequirePermissions("monitor:read")
  async list(@Query("cursor") cursor?: string) {
    const items = await this.prisma.monitor.findMany({ take: 51, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), include: { credential: { select: { id: true, name: true, type: true } }, tags: { include: { tag: true } } }, orderBy: { id: "asc" } });
    return items.map(({ tags, ...monitor }) => {
      const publicStatus = { enabled: monitor.publicStatusEnabled, displayName: monitor.publicDisplayName ?? undefined, group: monitor.publicGroup, order: monitor.publicOrder };
      return { ...monitor, publicStatus, latencyMs: monitor.lastLatencyMs, tags: tags.map(({ tag }) => tag.name), configurationComplete: monitorInputSchema.safeParse({ ...monitor, publicStatus, tagIds: [] }).success };
    });
  }
  @Get(":id") @RequirePermissions("monitor:read")
  async get(@Param("id") id: string) { const item = await this.prisma.monitor.findUnique({ where: { id }, include: { credential: { select: { id: true, name: true, type: true } }, tags: { include: { tag: true } }, results: { take: 100, orderBy: { checkedAt: "desc" } }, incidents: { take: 20, orderBy: { openedAt: "desc" } } } }); if (!item) throw new NotFoundException(); const publicStatus = { enabled: item.publicStatusEnabled, displayName: item.publicDisplayName ?? undefined, group: item.publicGroup, order: item.publicOrder }; return { ...item, publicStatus, latencyMs: item.lastLatencyMs, tags: item.tags.map(({ tag }) => tag.name), configurationComplete: monitorInputSchema.safeParse({ ...item, publicStatus, tagIds: [] }).success }; }
  @Post() @RequirePermissions("monitor:write")
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parse(monitorInputSchema, body);
    await assertCredential(this.prisma, input.credentialId, input.type);
    const { tagIds, credentialId, publicStatus, ...data } = input;
    const item = await this.prisma.monitor.create({ data: { ...data, credentialId: credentialId ?? null, config: data.config as Prisma.InputJsonValue, publicStatusEnabled: publicStatus.enabled, publicDisplayName: publicStatus.displayName ?? null, publicGroup: publicStatus.group, publicOrder: publicStatus.order, tags: { create: tagIds.map((tagId) => ({ tagId })) } } });
    await this.audit(request, "monitor.create", item.id); return { ...item, publicStatus };
  }
  @Patch(":id") @RequirePermissions("monitor:write")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parse(z.intersection(monitorInputSchema, z.object({ version: z.number().int() })), body);
    await assertCredential(this.prisma, input.credentialId, input.type);
    const { version, tagIds, credentialId, config, publicStatus, ...data } = input;
    const updated = await this.prisma.monitor.updateMany({ where: { id, version }, data: { ...data, credentialId: credentialId ?? null, config: config as Prisma.InputJsonValue, publicStatusEnabled: publicStatus.enabled, publicDisplayName: publicStatus.displayName ?? null, publicGroup: publicStatus.group, publicOrder: publicStatus.order, version: { increment: 1 } } });
    if (!updated.count) throw new ConflictException("Monitor changed; reload and retry");
    await this.prisma.$transaction([this.prisma.monitorTag.deleteMany({ where: { monitorId: id } }), ...tagIds.map((tagId) => this.prisma.monitorTag.create({ data: { monitorId: id, tagId } }))]);
    await this.audit(request, "monitor.update", id); const item = await this.prisma.monitor.findUnique({ where: { id } }); return item ? { ...item, publicStatus } : item;
  }
  @Post(":id/pause") @RequirePermissions("monitor:write") async pause(@Param("id") id: string, @Body() body: unknown) { const { version } = parse(z.object({ version: z.number().int() }), body); const result = await this.prisma.monitor.updateMany({ where: { id, version }, data: { status: MonitorStatus.PAUSED, enabled: false, version: { increment: 1 } } }); if (!result.count) throw new ConflictException("Monitor changed; reload and retry"); return this.prisma.monitor.findUnique({ where: { id } }); }
  @Post(":id/resume") @RequirePermissions("monitor:write") async resume(@Param("id") id: string, @Body() body: unknown) { const { version } = parse(z.object({ version: z.number().int() }), body); const result = await this.prisma.monitor.updateMany({ where: { id, version }, data: { status: MonitorStatus.UNKNOWN, enabled: true, consecutiveFailures: 0, consecutiveSuccesses: 0, nextCheckAt: new Date(), version: { increment: 1 } } }); if (!result.count) throw new ConflictException("Monitor changed; reload and retry"); return this.prisma.monitor.findUnique({ where: { id } }); }
  @Post(":id/check") @RequirePermissions("monitor:write") async check(@Param("id") id: string) { const monitor = await this.prisma.monitor.findUnique({ where: { id } }); if (!monitor) throw new NotFoundException(); const jobId = `manual-${id}-${Date.now()}`; await this.queues.probe.add("check", { monitorId: id }, { jobId }); return { queued: true, jobId }; }
  @Delete(":id") @RequirePermissions("monitor:write")
  async remove(@Param("id") id: string, @Req() request: AuthenticatedRequest) { await this.prisma.monitor.delete({ where: { id } }); await this.audit(request, "monitor.delete", id); return { ok: true }; }
  private audit(request: AuthenticatedRequest, action: string, resourceId: string) { return this.prisma.auditEvent.create({ data: { actorId: request.principal?.id ?? null, action, resourceType: "monitor", resourceId } }); }
}

@Controller("incidents")
export class IncidentsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() @RequirePermissions("incident:read") list() { return this.prisma.incident.findMany({ include: { monitor: true, assignee: { select: { id: true, displayName: true } }, comments: { include: { author: { select: { displayName: true } } } } }, orderBy: { openedAt: "desc" }, take: 100 }); }
  @Post(":id/acknowledge") @RequirePermissions("incident:manage") async acknowledge(@Param("id") id: string) { return this.prisma.incident.update({ where: { id }, data: { status: IncidentStatus.ACKNOWLEDGED, acknowledgedAt: new Date(), version: { increment: 1 } } }); }
  @Post(":id/comments") @RequirePermissions("incident:manage") async comment(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) { const { text } = parse(z.object({ text: z.string().trim().min(1).max(4_000) }), body); return this.prisma.incidentComment.create({ data: { incidentId: id, authorId: request.principal!.id, body: text } }); }
  @Patch(":id/assignee") @RequirePermissions("incident:manage") async assign(@Param("id") id: string, @Body() body: unknown) { const { assigneeId } = parse(z.object({ assigneeId: z.string().nullable() }), body); return this.prisma.incident.update({ where: { id }, data: { assigneeId, version: { increment: 1 } } }); }
  @Delete(":id") @RequirePermissions("incident:manage")
  async remove(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.prisma.$transaction(async (tx) => {
      const incident = await tx.incident.findUnique({ where: { id }, select: { id: true } });
      if (!incident) throw new NotFoundException("Incident not found");
      const activeRuns = await tx.workflowRun.count({
        where: { incidentId: id, status: { in: [RunStatus.PENDING, RunStatus.RUNNING] } },
      });
      if (activeRuns) throw new ConflictException("Incident has an active workflow execution");
      await tx.workflowRun.updateMany({ where: { incidentId: id }, data: { incidentId: null } });
      await tx.incident.delete({ where: { id } });
      await tx.auditEvent.create({
        data: {
          actorId: request.principal?.id ?? null,
          action: "incident.delete",
          resourceType: "incident",
          resourceId: id,
        },
      });
      return { ok: true };
    });
  }
}

@Controller("workflows")
export class WorkflowsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(QueueService) private readonly queues: QueueService) {}
  @Get() @RequirePermissions("workflow:read") async list() { const items = await this.prisma.workflow.findMany({ include: { monitor: true, steps: { orderBy: { position: "asc" }, include: { credential: { select: { id: true, name: true, type: true } } } } }, orderBy: { name: "asc" } }); return items.map((item) => ({ ...item, configurationComplete: workflowInputSchema.safeParse(item).success })); }
  @Get("runs/:runId") @RequirePermissions("workflow:read") run(@Param("runId") runId: string) { return getWorkflowRunSummary(this.prisma, runId); }
  @Post() @RequirePermissions("workflow:write") async create(@Body() body: unknown) {
    const input = parse(workflowInputSchema, body);
    await Promise.all(input.steps.map((step) => assertCredential(this.prisma, step.credentialId, step.type)));
    const { steps, monitorId, ...workflow } = input;
    return this.prisma.workflow.create({ data: {
      ...workflow,
      ...(monitorId ? { monitor: { connect: { id: monitorId } } } : {}),
      steps: { create: steps.map(({ id: _id, credentialId, ...step }, position) => ({
        ...step, position, config: step.config as Prisma.InputJsonValue,
        ...(credentialId ? { credential: { connect: { id: credentialId } } } : {}),
      })) },
    }, include: { steps: true } });
  }
  @Patch(":id") @RequirePermissions("workflow:write") async update(@Param("id") id: string, @Body() body: unknown) {
    const input = parse(z.intersection(workflowInputSchema, z.object({ version: z.number().int() })), body);
    await Promise.all(input.steps.map((step) => assertCredential(this.prisma, step.credentialId, step.type)));
    const { steps, version, ...workflow } = input;
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.workflow.updateMany({ where: { id, version }, data: { ...workflow, monitorId: workflow.monitorId ?? null, version: { increment: 1 } } });
      if (!result.count) throw new ConflictException("Workflow changed; reload and retry");
      const existing = await tx.workflowStep.findMany({
        where: { workflowId: id },
        orderBy: { position: "asc" },
        select: { id: true, position: true, _count: { select: { stepRuns: true } } },
      });
      const existingById = new Map(existing.map((step) => [step.id, step]));
      const claimed = new Set<string>();
      const reconciled = steps.map((step, position) => {
        const fallback = existing.find(
          (candidate) => candidate.position === position && !claimed.has(candidate.id),
        );
        const stepId = step.id ?? fallback?.id;
        if (stepId && (!existingById.has(stepId) || claimed.has(stepId))) {
          throw new BadRequestException("Workflow step identity is invalid");
        }
        if (stepId) claimed.add(stepId);
        return { step, position, stepId };
      });
      const removed = existing.filter((step) => !claimed.has(step.id));
      if (removed.some((step) => step._count.stepRuns > 0)) {
        throw new ConflictException("Workflow step has execution history and cannot be removed");
      }

      // Move retained rows out of the unique position range before applying reordering.
      await Promise.all(
        existing.map((step, index) =>
          tx.workflowStep.update({
            where: { id: step.id },
            data: { position: -index - 1 },
          }),
        ),
      );
      await Promise.all(removed.map((step) => tx.workflowStep.delete({ where: { id: step.id } })));
      await Promise.all(
        reconciled.map(({ step, position, stepId }) => {
          const { id: _stepId, credentialId, ...data } = step;
          const values = {
            ...data,
            credentialId: credentialId ?? null,
            position,
            config: step.config as Prisma.InputJsonValue,
          };
          return stepId
            ? tx.workflowStep.update({ where: { id: stepId }, data: values })
            : tx.workflowStep.create({ data: { ...values, workflowId: id } });
        }),
      );
    });
    return this.prisma.workflow.findUnique({ where: { id }, include: { steps: { orderBy: { position: "asc" } } } });
  }
  @Delete(":id") @RequirePermissions("workflow:write") async remove(@Param("id") id: string) { const runs = await this.prisma.workflowRun.count({ where: { workflowId: id } }); if (runs) throw new ConflictException("Workflow has execution history and cannot be deleted"); await this.prisma.workflow.delete({ where: { id } }); return { ok: true }; }
  @Post(":id/execute") @RequirePermissions("workflow:execute") async execute(@Param("id") id: string) { const workflow = await this.prisma.workflow.findUnique({ where: { id }, include: { steps: true } }); if (!workflow || !workflow.enabled) throw new NotFoundException(); if (!workflowInputSchema.safeParse(workflow).success) throw new ConflictException("Workflow configuration is incomplete"); const run = await this.prisma.workflowRun.create({ data: { workflowId: id, trigger: TriggerType.MANUAL, idempotencyKey: `manual:${id}:${randomBytes(16).toString("hex")}` } }); await this.queues.workflow.add("execute", { runId: run.id }, { jobId: run.id }); return getWorkflowRunSummary(this.prisma, run.id); }
}

@Controller("tags")
export class TagsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() @RequirePermissions("monitor:read") list() { return this.prisma.tag.findMany({ orderBy: { name: "asc" } }); }
  @Post() @RequirePermissions("monitor:write") create(@Body() body: unknown) { const input = parse(z.object({ name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#147d64") }), body); return this.prisma.tag.create({ data: input }); }
}

@Controller("approvals")
export class ApprovalsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(QueueService) private readonly queues: QueueService) {}
  @Get() @RequirePermissions("workflow:approve") list() { return this.prisma.approval.findMany({ where: { status: ApprovalStatus.PENDING }, include: { workflow: true, incident: { include: { monitor: true } } }, orderBy: { createdAt: "desc" } }); }
  @Post(":id/approve") @RequirePermissions("workflow:approve") async approve(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    const approval = await this.prisma.approval.findUnique({ where: { id } });
    if (!approval || approval.status !== ApprovalStatus.PENDING || approval.expiresAt <= new Date()) throw new ConflictException("Approval is no longer pending");
    const run = await this.prisma.$transaction(async (tx) => {
      await tx.approval.update({ where: { id }, data: { status: ApprovalStatus.APPROVED, decidedAt: new Date(), decidedById: request.principal!.id } });
      return tx.workflowRun.create({ data: { workflowId: approval.workflowId, incidentId: approval.incidentId, trigger: TriggerType.DOWN, idempotencyKey: `approval:${id}` } });
    });
    await this.queues.workflow.add("execute", { runId: run.id }, { jobId: run.id }); return getWorkflowRunSummary(this.prisma, run.id);
  }
  @Post(":id/reject") @RequirePermissions("workflow:approve") reject(@Param("id") id: string, @Req() request: AuthenticatedRequest) { return this.prisma.approval.update({ where: { id }, data: { status: ApprovalStatus.REJECTED, decidedAt: new Date(), decidedById: request.principal!.id } }); }
}

@Controller("credentials")
export class CredentialsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() @RequirePermissions("credential:manage") async list() { const items = await this.prisma.credential.findMany({ orderBy: { name: "asc" } }); return items.map(({ encrypted: _encrypted, ...item }) => ({ ...item, configured: true })); }
  @Post() @RequirePermissions("credential:manage") async create(@Body() body: unknown) {
    const input = parse(credentialInputSchema, body);
    const id = crypto.randomUUID();
    return this.prisma.credential.create({ data: { id, name: input.name, type: input.type, encrypted: encryptSecret(credentialSecret(input), masterKey(), id) as unknown as Prisma.InputJsonValue }, select: { id: true, name: true, type: true, version: true, createdAt: true } });
  }
  @Patch(":id") @RequirePermissions("credential:manage") async rotate(@Param("id") id: string, @Body() body: unknown) {
    const input = parse(z.intersection(credentialInputSchema, z.object({ version: z.number().int() })), body);
    const references = await this.prisma.credential.findUnique({ where: { id }, include: { monitors: { select: { type: true } }, steps: { select: { type: true } } } });
    if (!references) throw new NotFoundException();
    const owners = [...references.monitors.map(({ type }) => type), ...references.steps.map(({ type }) => type)];
    if (owners.some((owner) => !compatibleCredentialTypes(owner).includes(input.type as CredentialType))) throw new ConflictException("New credential type is incompatible with an existing reference");
    const result = await this.prisma.credential.updateMany({ where: { id, version: input.version }, data: { name: input.name, type: input.type, encrypted: encryptSecret(credentialSecret(input), masterKey(), id) as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    if (!result.count) throw new ConflictException("Credential changed; reload and retry");
    return this.prisma.credential.findUnique({ where: { id }, select: { id: true, name: true, type: true, version: true, updatedAt: true } });
  }
  @Delete(":id") @RequirePermissions("credential:manage") async remove(@Param("id") id: string) { const item = await this.prisma.credential.findUnique({ where: { id }, include: { _count: { select: { monitors: true, steps: true } } } }); if (!item) throw new NotFoundException(); if (item._count.monitors || item._count.steps) throw new ConflictException("Credential is in use"); await this.prisma.credential.delete({ where: { id } }); return { ok: true }; }
}

@Controller("admin")
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get("roles") @RequirePermissions("role:manage") roles() { return this.prisma.role.findMany({ orderBy: { name: "asc" } }); }
  @Post("roles") @RequirePermissions("role:manage") createRole(@Body() body: unknown) { const input = parse(z.object({ name: z.string().min(1), description: z.string().optional(), permissions: z.array(z.enum(PERMISSIONS)) }), body); return this.prisma.role.create({ data: { ...input, description: input.description ?? null } }); }
  @Patch("roles/:id") @RequirePermissions("role:manage") async updateRole(@Param("id") id: string, @Body() body: unknown) { const input = parse(z.object({ version: z.number().int(), name: z.string().min(1), description: z.string().nullable().optional(), permissions: z.array(z.enum(PERMISSIONS)) }), body); const role = await this.prisma.role.findUnique({ where: { id } }); if (!role) throw new NotFoundException(); if (role.system) throw new ConflictException("System roles cannot be edited"); const result = await this.prisma.role.updateMany({ where: { id, version: input.version }, data: { name: input.name, description: input.description ?? null, permissions: input.permissions, version: { increment: 1 } } }); if (!result.count) throw new ConflictException("Role changed; reload and retry"); return this.prisma.role.findUnique({ where: { id } }); }
  @Delete("roles/:id") @RequirePermissions("role:manage") async deleteRole(@Param("id") id: string) { const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } }); if (!role) throw new NotFoundException(); if (role.system || role._count.users) throw new ConflictException("Role cannot be deleted"); await this.prisma.role.delete({ where: { id } }); return { ok: true }; }
  @Get("users") @RequirePermissions("user:manage") users() { return this.prisma.user.findMany({ select: { id: true, email: true, displayName: true, locale: true, timezone: true, version: true, disabledAt: true, roles: { include: { role: true } } } }); }
  @Post("users") @RequirePermissions("user:manage") async createUser(@Body() body: unknown) { const input = parse(z.object({ email: z.string().email(), displayName: z.string().min(1), password: z.string().min(12), roleIds: z.array(z.string()) }), body); return this.prisma.user.create({ data: { email: input.email.toLowerCase(), displayName: input.displayName, passwordHash: await hashPassword(input.password), forcePasswordChange: true, roles: { create: input.roleIds.map((roleId) => ({ roleId })) } }, select: { id: true, email: true, displayName: true } }); }
  @Patch("users/:id") @RequirePermissions("user:manage") async updateUser(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) { const input = parse(z.object({ version: z.number().int(), displayName: z.string().min(1), locale: z.enum(["zh-CN", "en-US"]), timezone: z.string().min(1), disabled: z.boolean(), roleIds: z.array(z.string()) }), body); if (id === request.principal!.id && input.disabled) throw new ConflictException("You cannot disable your own account"); await this.prisma.$transaction(async (tx) => { const result = await tx.user.updateMany({ where: { id, version: input.version }, data: { displayName: input.displayName, locale: input.locale, timezone: input.timezone, disabledAt: input.disabled ? new Date() : null, version: { increment: 1 } } }); if (!result.count) throw new ConflictException("User changed; reload and retry"); await tx.userRole.deleteMany({ where: { userId: id } }); await tx.userRole.createMany({ data: input.roleIds.map((roleId) => ({ userId: id, roleId })) }); }); return { ok: true }; }
  @Get("audit-events") @RequirePermissions("audit:read") audit() { return this.prisma.auditEvent.findMany({ take: 200, orderBy: { createdAt: "desc" } }); }
  @Get("settings") @RequirePermissions("settings:manage") settings() { return this.prisma.setting.findMany(); }
  @Post("settings") @RequirePermissions("settings:manage") setting(@Body() body: unknown) { const input = parse(z.object({ key: z.string().min(1), value: z.unknown() }), body); return this.prisma.setting.upsert({ where: { key: input.key }, create: { key: input.key, value: input.value as Prisma.InputJsonValue }, update: { value: input.value as Prisma.InputJsonValue } }); }
  @Put("settings") @RequirePermissions("settings:manage")
  async saveSettings(@Body() body: unknown) {
    const { settings } = parse(z.object({ settings: z.array(z.object({ key: z.string().min(1), value: z.unknown(), version: z.number().int().optional() })) }), body);
    for (const setting of settings) {
      if (setting.key === "statusPageEnabled" && typeof setting.value !== "boolean") throw new BadRequestException("Status page enabled must be boolean");
      if (setting.key === "statusPageTitle" && (typeof setting.value !== "string" || !setting.value.trim() || setting.value.length > 80)) throw new BadRequestException("Status page title is invalid");
      if (setting.key === "statusPageDescription" && (typeof setting.value !== "string" || setting.value.length > 300)) throw new BadRequestException("Status page description is invalid");
      if (setting.key === "statusPageSupportUrl" && setting.value !== null) {
        if (typeof setting.value !== "string") throw new BadRequestException("Status page support URL is invalid");
        try {
          const url = new URL(setting.value);
          if (!["http:", "https:", "mailto:"].includes(url.protocol)) throw new Error();
        } catch {
          throw new BadRequestException("Status page support URL is invalid");
        }
      }
    }
    await this.prisma.$transaction(settings.map((setting) => this.prisma.setting.upsert({ where: { key: setting.key }, create: { key: setting.key, value: setting.value as Prisma.InputJsonValue }, update: { value: setting.value as Prisma.InputJsonValue, version: { increment: 1 } } })));
    return this.prisma.setting.findMany();
  }
}

@Controller("tokens")
export class TokensController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() @RequirePermissions("token:manage") list(@Req() request: AuthenticatedRequest) { return this.prisma.apiToken.findMany({ where: { userId: request.principal!.id }, select: { id: true, name: true, scopes: true, expiresAt: true, revokedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }); }
  @Post() @RequirePermissions("token:manage") async create(@Body() body: unknown, @Req() request: AuthenticatedRequest) { const input = parse(z.object({ name: z.string().min(1), scopes: z.array(z.enum(PERMISSIONS)), expiresAt: z.string().datetime().optional() }), body); const allowed = new Set(request.principal!.permissions); if (input.scopes.some((scope) => !allowed.has(scope))) throw new BadRequestException("Token cannot expand permissions"); const raw = `nst_${randomBytes(32).toString("base64url")}`; const item = await this.prisma.apiToken.create({ data: { name: input.name, scopes: input.scopes, tokenHash: digest(raw.slice(4)), userId: request.principal!.id, ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}) } }); return { id: item.id, token: raw }; }
  @Delete(":id") @RequirePermissions("token:manage") async revoke(@Param("id") id: string, @Req() request: AuthenticatedRequest) { await this.prisma.apiToken.updateMany({ where: { id, userId: request.principal!.id }, data: { revokedAt: new Date() } }); return { ok: true }; }
}

@Controller("agents")
export class AgentsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() @RequirePermissions("agent:read") list() { return this.prisma.agent.findMany({ orderBy: { name: "asc" } }); }
  @Post("enroll") @RequirePermissions("agent:manage") async enroll(@Body() body: unknown) { const { name } = parse(z.object({ name: z.string().min(1).max(120) }), body); const token = randomBytes(32).toString("base64url"); const agent = await this.prisma.agent.create({ data: { name, tokenHash: digest(token) } }); return { id: agent.id, enrollmentToken: token }; }
  @Post(":id/rotate") @RequirePermissions("agent:manage") async rotate(@Param("id") id: string, @Body() body: unknown) { const { rowVersion } = parse(z.object({ rowVersion: z.number().int() }), body); const token = randomBytes(32).toString("base64url"); const result = await this.prisma.agent.updateMany({ where: { id, rowVersion, revokedAt: null }, data: { tokenHash: digest(token), enrolledAt: null, status: "OFFLINE", rowVersion: { increment: 1 } } }); if (!result.count) throw new ConflictException("Agent changed; reload and retry"); return { enrollmentToken: token }; }
  @Delete(":id") @RequirePermissions("agent:manage") async revoke(@Param("id") id: string, @Body() body: unknown) { const { rowVersion } = parse(z.object({ rowVersion: z.number().int() }), body); const result = await this.prisma.agent.updateMany({ where: { id, rowVersion }, data: { revokedAt: new Date(), status: "REVOKED", rowVersion: { increment: 1 } } }); if (!result.count) throw new ConflictException("Agent changed; reload and retry"); return { ok: true }; }
}

@Controller("maintenance-windows")
export class MaintenanceController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() @RequirePermissions("monitor:read") list() { return this.prisma.maintenanceWindow.findMany({ include: { monitor: true } }); }
  @Post() @RequirePermissions("monitor:write") create(@Body() body: unknown) { const input = parse(maintenanceInputSchema, body); const { monitorId, startsAt, endsAt, ...data } = input; return this.prisma.maintenanceWindow.create({ data: { ...data, monitorId: monitorId ?? null, ...(startsAt ? { startsAt: new Date(startsAt) } : {}), ...(endsAt ? { endsAt: new Date(endsAt) } : {}) } }); }
  @Patch(":id") @RequirePermissions("monitor:write") async update(@Param("id") id: string, @Body() body: unknown) { const input = parse(z.intersection(maintenanceInputSchema, z.object({ version: z.number().int() })), body); const { version, monitorId, startsAt, endsAt, ...data } = input; const result = await this.prisma.maintenanceWindow.updateMany({ where: { id, version }, data: { ...data, monitorId: monitorId ?? null, startsAt: startsAt ? new Date(startsAt) : null, endsAt: endsAt ? new Date(endsAt) : null, version: { increment: 1 } } }); if (!result.count) throw new ConflictException("Maintenance window changed; reload and retry"); return this.prisma.maintenanceWindow.findUnique({ where: { id } }); }
  @Delete(":id") @RequirePermissions("monitor:write") async remove(@Param("id") id: string) { await this.prisma.maintenanceWindow.delete({ where: { id } }); return { ok: true }; }
}
