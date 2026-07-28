import { z } from "zod";

export type MonitorStatus = "UNKNOWN" | "UP" | "DEGRADED" | "DOWN" | "PAUSED";
export type MonitorType = "HTTP" | "WEBSOCKET" | "TCP" | "ICMP";
export type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export type Transition = "DOWN" | "RECOVERY" | null;
export type RunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN"
  | "CANCELLED";

export type PublicServiceStatus =
  | "OPERATIONAL"
  | "DEGRADED"
  | "OUTAGE"
  | "MAINTENANCE"
  | "UNKNOWN";
export type PublicOverallStatus =
  | "OPERATIONAL"
  | "DEGRADED"
  | "PARTIAL_OUTAGE"
  | "MAJOR_OUTAGE"
  | "MAINTENANCE"
  | "NO_DATA";

export interface PublicStatusDay {
  date: string;
  status: "OPERATIONAL" | "DEGRADED" | "OUTAGE" | "NO_DATA";
  uptimePercent: number | null;
}

export interface PublicStatusService {
  id: string;
  name: string;
  status: PublicServiceStatus;
  uptimePercent: number | null;
  history: PublicStatusDay[];
}

export interface PublicStatusSnapshot {
  enabled: boolean;
  generatedAt: string;
  title?: string;
  description?: string;
  supportUrl?: string | null;
  themeColor?: string;
  overallStatus?: PublicOverallStatus;
  groups?: Array<{ name: string; services: PublicStatusService[] }>;
  incidents?: Array<{
    id: string;
    serviceName: string;
    status: "ACTIVE" | "RESOLVED";
    startedAt: string;
    resolvedAt: string | null;
  }>;
}

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  workflow: { id: string; name: string };
  status: RunStatus;
  trigger: "DOWN" | "RECOVERY" | "MANUAL";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: Array<{
    id: string;
    name: string;
    position: number;
    attempt: number;
    status: RunStatus;
  }>;
}

export type SystemEvent =
  | {
      type: "monitor.updated";
      data: { monitorId: string; status: MonitorStatus; result: unknown };
    }
  | {
      type: "workflow.finished";
      data: { runId: string; status: RunStatus };
    };

export interface MonitorState {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface MonitorSummary {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  status: MonitorStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  tags: string[];
}

export interface DashboardSnapshot {
  monitors: MonitorSummary[];
  openIncidents: number;
  pendingApprovals: number;
  uptimePercent: number;
}

export const PERMISSIONS = [
  "monitor:read", "monitor:write", "workflow:read", "workflow:write",
  "workflow:execute", "workflow:approve", "credential:manage",
  "incident:read", "incident:manage", "agent:read", "agent:manage",
  "user:manage", "role:manage", "token:manage", "audit:read", "settings:manage"
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const hasProtocol = (value: string, protocols: string[]) => URL.canParse(value) && protocols.includes(new URL(value).protocol);
const httpUrlSchema = z.string().url().refine((value) => hasProtocol(value, ["http:", "https:"]), "Expected an HTTP(S) URL");
const websocketUrlSchema = z.string().url().refine((value) => hasProtocol(value, ["ws:", "wss:"]), "Expected a WS(S) URL");
export const publicMonitorConfigSchema = z.object({
  enabled: z.boolean().default(false),
  displayName: z.string().trim().min(1).max(120).optional(),
  group: z.string().trim().min(1).max(80).default("服务状态"),
  order: z.number().int().min(0).max(100_000).default(0),
}).superRefine((value, context) => {
  if (value.enabled && !value.displayName) {
    context.addIssue({ code: "custom", path: ["displayName"], message: "A public display name is required" });
  }
});
const commonMonitorShape = {
  name: z.string().trim().min(1).max(120),
  credentialId: z.string().nullable().optional(),
  intervalSeconds: z.number().int().min(10).max(86_400).default(60),
  timeoutMs: z.number().int().min(100).max(300_000).default(10_000),
  failureThreshold: z.number().int().min(1).max(10).default(3),
  recoveryThreshold: z.number().int().min(1).max(10).default(2),
  tagIds: z.array(z.string()).default([]),
  publicStatus: publicMonitorConfigSchema.default({ enabled: false, group: "服务状态", order: 0 }),
};

export const httpMonitorConfigSchema = z.object({
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  headers: z.record(z.string().trim().min(1), z.string()),
  body: z.string().optional(),
  expectedStatusMin: z.number().int().min(100).max(599),
  expectedStatusMax: z.number().int().min(100).max(599),
  maxLatencyMs: z.number().int().positive().optional(),
  textContains: z.string().min(1).optional(),
  regex: z.string().min(1).optional(),
  jsonPath: z.string().min(1).optional(),
  jsonPathExpected: z.unknown().optional(),
  verifyTls: z.boolean(),
}).superRefine((value, context) => {
  if (value.expectedStatusMin > value.expectedStatusMax) context.addIssue({ code: "custom", path: ["expectedStatusMax"], message: "Maximum status must be greater than or equal to minimum status" });
});

export const websocketMonitorConfigSchema = z.object({
  headers: z.record(z.string().trim().min(1), z.string()),
  sendFormat: z.enum(["NONE", "TEXT", "JSON"]),
  send: z.string().optional(),
  expect: z.enum(["HANDSHAKE", "MESSAGE", "PONG"]),
  textContains: z.string().optional(),
  verifyTls: z.boolean(),
}).superRefine((value, context) => {
  if (value.sendFormat !== "NONE" && !value.send?.length) context.addIssue({ code: "custom", path: ["send"], message: "A message is required for the selected send mode" });
  if (value.expect === "MESSAGE" && !value.textContains?.length) context.addIssue({ code: "custom", path: ["textContains"], message: "Expected message text is required" });
  if (value.sendFormat === "JSON" && value.send) {
    try { JSON.parse(value.send); } catch { context.addIssue({ code: "custom", path: ["send"], message: "Message must be valid JSON" }); }
  }
});

export const monitorInputSchema = z.discriminatedUnion("type", [
  z.object({ ...commonMonitorShape, type: z.literal("HTTP"), target: httpUrlSchema, config: httpMonitorConfigSchema }),
  z.object({ ...commonMonitorShape, type: z.literal("WEBSOCKET"), target: websocketUrlSchema, config: websocketMonitorConfigSchema }),
  z.object({ ...commonMonitorShape, type: z.literal("TCP"), target: z.string().trim().regex(/^(?:\[[0-9a-f:]+\]|[^:\s]+):(?:[1-9][0-9]{0,4})$/iu, "Expected host:port"), config: z.object({}).default({}) }),
  z.object({ ...commonMonitorShape, type: z.literal("ICMP"), target: z.string().trim().min(1).max(253), config: z.object({}).default({}) }),
]);
export type MonitorInput = z.infer<typeof monitorInputSchema>;

const commonStepShape = {
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  credentialId: z.string().nullable().optional(),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
  retries: z.number().int().min(0).max(5).default(0),
  continueOnFailure: z.boolean().default(false),
};
const httpActionConfigSchema = z.object({
  url: httpUrlSchema,
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  headers: z.record(z.string().trim().min(1), z.string()),
  body: z.string().optional(),
  verifyTls: z.boolean(),
});

export const workflowStepInputSchema = z.discriminatedUnion("type", [
  z.object({ ...commonStepShape, type: z.literal("HTTP"), config: httpActionConfigSchema }),
  z.object({ ...commonStepShape, type: z.literal("WEBHOOK"), config: httpActionConfigSchema }),
  z.object({ ...commonStepShape, type: z.literal("SSH"), credentialId: z.string().min(1), config: z.object({ host: z.string().trim().min(1), port: z.number().int().min(1).max(65_535).default(22), username: z.string().trim().min(1), command: z.string().min(1) }) }),
  z.object({ ...commonStepShape, type: z.literal("SHELL"), config: z.object({ command: z.string().min(1) }) }),
  z.object({ ...commonStepShape, type: z.literal("AGENT_SHELL"), config: z.object({ agentId: z.string().min(1), command: z.string().min(1) }) }),
  z.object({ ...commonStepShape, type: z.literal("EMAIL"), credentialId: z.string().min(1), config: z.object({ to: z.string().trim().min(1), subject: z.string().min(1), body: z.string() }) }),
]);
export type WorkflowStepInput = z.infer<typeof workflowStepInputSchema>;

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  monitorId: z.string().nullable().optional(),
  trigger: z.enum(["DOWN", "RECOVERY", "MANUAL"]),
  approvalMode: z.enum(["AUTO", "APPROVAL"]),
  approvalTimeoutMinutes: z.number().int().min(1).max(1_440).default(15),
  steps: z.array(workflowStepInputSchema).min(1),
});
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export const credentialInputSchema = z.discriminatedUnion("type", [
  z.object({ name: z.string().trim().min(1).max(120), type: z.literal("SSH_PASSWORD"), secret: z.string().min(1) }),
  z.object({
    name: z.string().trim().min(1).max(120),
    type: z.literal("SSH_KEY"),
    secret: z.string().min(1),
    passphrase: z.string().max(4_096).optional(),
  }),
  z.object({ name: z.string().trim().min(1).max(120), type: z.literal("HTTP_BEARER"), secret: z.string().min(1) }),
  z.object({ name: z.string().trim().min(1).max(120), type: z.literal("HTTP_BASIC"), username: z.string().min(1), password: z.string().min(1) }),
  z.object({ name: z.string().trim().min(1).max(120), type: z.literal("HTTP_API_KEY"), headerName: z.string().trim().min(1), value: z.string().min(1) }),
  z.object({
    name: z.string().trim().min(1).max(120),
    type: z.literal("WS_TOKEN"),
    token: z.string().min(1),
    placement: z.enum(["BEARER", "QUERY"]).default("BEARER"),
    queryParamName: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/, "Query parameter name contains unsupported characters").default("access_token"),
  }),
  z.object({ name: z.string().trim().min(1).max(120), type: z.literal("SMTP"), host: z.string().trim().min(1), port: z.number().int().min(1).max(65_535), secure: z.boolean(), user: z.string().min(1), password: z.string().min(1), from: z.string().email() }),
]);
export type CredentialInput = z.infer<typeof credentialInputSchema>;
