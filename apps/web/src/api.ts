import type {
  CredentialInput,
  MonitorInput,
  MonitorType,
  WorkflowRunSummary,
  WorkflowInput,
  WorkflowStepInput,
  PublicStatusSnapshot,
} from "@netsentinel/contracts";

export type {
  CredentialInput,
  MonitorInput,
  MonitorType,
  WorkflowInput,
  WorkflowStepInput,
  WorkflowRunSummary,
  PublicStatusSnapshot,
};
export type MonitorStatus = "UNKNOWN" | "UP" | "DEGRADED" | "DOWN" | "PAUSED";

export interface ProbeResult {
  id: string;
  ok: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

export type Monitor = MonitorInput & {
  id: string;
  status: MonitorStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  tags: string[];
  version: number;
  enabled: boolean;
  configurationComplete: boolean;
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  results?: ProbeResult[];
};
export interface Incident {
  id: string;
  title: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  openedAt: string;
  monitor: { name: string };
  assignee?: { displayName: string } | null;
}
export interface Approval {
  id: string;
  workflow: { name: string };
  incident: { monitor: { name: string } };
  expiresAt: string;
}
export type WorkflowStep = WorkflowStepInput & {
  id: string;
  position: number;
  credential?: { id: string; name: string; type: string } | null;
};
export type Workflow = Omit<WorkflowInput, "steps"> & {
  id: string;
  version: number;
  enabled: boolean;
  monitor?: { id: string; name: string } | null;
  steps: WorkflowStep[];
  configurationComplete: boolean;
};
export interface Credential {
  id: string;
  name: string;
  type: CredentialInput["type"];
  configured: boolean;
  createdAt: string;
  version: number;
}
export interface Agent {
  id: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "REVOKED";
  version?: string;
  rowVersion: number;
  lastSeenAt?: string;
}
export interface MaintenanceWindow {
  id: string;
  name: string;
  timezone: string;
  startsAt?: string | null;
  endsAt?: string | null;
  cron?: string | null;
  durationMinutes?: number | null;
  enabled: boolean;
  monitorId?: string | null;
  monitor?: { id: string; name: string } | null;
  version: number;
}
export interface MaintenanceInput {
  name: string;
  monitorId?: string | null;
  timezone: string;
  startsAt?: string;
  endsAt?: string;
  cron?: string;
  durationMinutes?: number;
  enabled: boolean;
}
export interface AuditEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  createdAt: string;
  actorId?: string;
}
export type RuntimeLogStatus =
  | "SUCCESS"
  | "FAILURE"
  | "IN_PROGRESS"
  | "UNKNOWN";
export type RuntimeLogSource = "PROBE" | "ACTION";
interface RuntimeLogBase {
  id: string;
  status: RuntimeLogStatus;
  timestamp: string;
  title: string;
  summary: string;
  monitor?: {
    id: string;
    name: string;
    target?: string;
    type?: MonitorType;
  } | null;
  durationMs?: number | null;
}
export type RuntimeLog = RuntimeLogBase &
  (
    | {
        source: "PROBE";
        details: {
          statusCode?: number | null;
          errorCode?: string | null;
          errorMessage?: string | null;
        };
      }
    | {
        source: "ACTION";
        details: {
          runId: string;
          trigger: string;
          runStatus: string;
          startedAt?: string | null;
          finishedAt?: string | null;
          steps: Array<{
            id: string;
            name: string;
            type: string;
            attempt: number;
            status: string;
            durationMs?: number | null;
            output?: string | null;
            errorMessage?: string | null;
          }>;
        };
      }
  );
export interface RuntimeLogPage {
  items: RuntimeLog[];
  nextCursor: string | null;
}
export interface RuntimeLogFilters {
  source: "ALL" | RuntimeLogSource;
  status: "ALL" | RuntimeLogStatus;
  monitorId?: string;
  runId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}
export interface Role {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  system: boolean;
  version: number;
}
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  locale: "zh-CN" | "en-US";
  timezone: string;
  version: number;
  disabledAt?: string | null;
  roles: Array<{ role: Role }>;
}
export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}
export interface Setting {
  key: string;
  value: unknown;
  version: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  permissions: string[];
  authentication?: "session" | "token";
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: Array<{ path: string; message: string; code?: string }> = [],
    public problemTitle?: string,
  ) {
    super(message);
  }
}

const demo = import.meta.env.VITE_DEMO_MODE !== "false";
let csrfToken = sessionStorage.getItem("netsentinel.csrf") ?? "";
const demoMonitors: Monitor[] = [];
const demoWorkflows: Workflow[] = [];
const demoCredentials: Credential[] = [];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      detail?: string;
      title?: string;
      errors?: Array<{
        path: Array<string | number> | string;
        message: string;
        code?: string;
      }>;
    };
    const errors = (problem.errors ?? []).map((item) => ({
      ...item,
      path: Array.isArray(item.path) ? item.path.join(".") : item.path,
    }));
    throw new ApiError(
      problem.detail ?? problem.title ?? `Request failed (${response.status})`,
      response.status,
      errors,
      problem.title,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

async function requestMultipart<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    body,
    credentials: "include",
    headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      detail?: string;
      title?: string;
    };
    throw new ApiError(
      problem.detail ?? problem.title ?? `Request failed (${response.status})`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  isDemo: demo,
  async health() {
    if (demo) return { status: "ready", workerConnected: true };
    return request<{ status: string; workerConnected: boolean }>(
      "/health/ready",
    );
  },
  async publicStatus() {
    return request<PublicStatusSnapshot>("/public/status");
  },
  async login(email: string, password: string) {
    if (demo)
      return {
        user: { id: "demo", email, displayName: "管理员", permissions: ["*"] },
        csrfToken: "demo",
      };
    const result = await request<{
      user: {
        id: string;
        email: string;
        displayName: string;
        avatarUrl: string | null;
        permissions: string[];
      };
      csrfToken: string;
    }>("/auth/login", json("POST", { email, password }));
    csrfToken = result.csrfToken;
    sessionStorage.setItem("netsentinel.csrf", csrfToken);
    return result;
  },
  async me() {
    if (demo) {
      return {
        user: {
          id: "demo",
          email: "admin@netsentinel.local",
          displayName: "管理员",
          avatarUrl: null,
          permissions: ["*"],
          authentication: "session" as const,
        },
      };
    }
    return request<{ user: CurrentUser }>("/auth/me");
  },
  async updateProfile(displayName: string) {
    if (demo) {
      return { user: { ...(await this.me()).user, displayName } };
    }
    return request<{ user: CurrentUser }>(
      "/auth/me",
      json("PATCH", { displayName }),
    );
  },
  async uploadAvatar(file: File) {
    if (demo) return { user: (await this.me()).user };
    const body = new FormData();
    body.append("avatar", file);
    return requestMultipart<{ user: CurrentUser }>("/auth/me/avatar", body);
  },
  async deleteAvatar() {
    if (demo) return { user: (await this.me()).user };
    return request<{ user: CurrentUser }>("/auth/me/avatar", { method: "DELETE" });
  },
  async logout() {
    if (!demo) await request<{ ok: true }>("/auth/logout", { method: "POST" });
    sessionStorage.removeItem("netsentinel.user");
    sessionStorage.removeItem("netsentinel.csrf");
  },
  async dashboard() {
    if (demo)
      return {
        monitors: demoMonitors,
        openIncidents: 0,
        pendingApprovals: 0,
        uptimePercent: null,
        probeResults24h: 0,
        latencyTrend: [],
      };
    return request<{
      monitors: Monitor[];
      openIncidents: number;
      pendingApprovals: number;
      uptimePercent: number | null;
      probeResults24h: number;
      latencyTrend: Array<{ bucket: string; p50Ms: number }>;
    }>("/dashboard");
  },
  async monitors() {
    return demo ? [...demoMonitors] : request<Monitor[]>("/monitors");
  },
  async monitor(id: string) {
    return demo
      ? demoMonitors.find((item) => item.id === id)!
      : request<Monitor>(`/monitors/${id}`);
  },
  async createMonitor(input: MonitorInput) {
    if (demo) {
      const item = {
        ...input,
        id: crypto.randomUUID(),
        status: "UNKNOWN",
        latencyMs: null,
        lastCheckedAt: null,
        tags: [],
        version: 1,
        enabled: true,
        configurationComplete: true,
      } as Monitor;
      demoMonitors.unshift(item);
      return item;
    }
    return request<Monitor>("/monitors", json("POST", input));
  },
  async updateMonitor(id: string, input: MonitorInput, version: number) {
    return request<Monitor>(
      `/monitors/${id}`,
      json("PATCH", { ...input, version }),
    );
  },
  async deleteMonitor(id: string) {
    if (demo) {
      demoMonitors.splice(
        demoMonitors.findIndex((item) => item.id === id),
        1,
      );
      return { ok: true };
    }
    return request<{ ok: true }>(`/monitors/${id}`, json("DELETE"));
  },
  async setMonitorPaused(id: string, version: number, paused: boolean) {
    return request<Monitor>(
      `/monitors/${id}/${paused ? "pause" : "resume"}`,
      json("POST", { version }),
    );
  },
  async checkMonitor(id: string) {
    return request<{ queued: true; jobId: string }>(
      `/monitors/${id}/check`,
      json("POST"),
    );
  },
  async incidents() {
    return demo ? ([] as Incident[]) : request<Incident[]>("/incidents");
  },
  async acknowledge(id: string) {
    return request(`/incidents/${id}/acknowledge`, json("POST"));
  },
  async deleteIncident(id: string) {
    return request<{ ok: true }>(`/incidents/${id}`, json("DELETE"));
  },
  async approvals() {
    return demo ? ([] as Approval[]) : request<Approval[]>("/approvals");
  },
  async decideApproval(id: string, decision: "approve" | "reject") {
    return request<WorkflowRunSummary | { id: string; status: string }>(
      `/approvals/${id}/${decision}`,
      json("POST"),
    );
  },
  async workflows() {
    return demo ? [...demoWorkflows] : request<Workflow[]>("/workflows");
  },
  async createWorkflow(input: WorkflowInput) {
    return request<Workflow>("/workflows", json("POST", input));
  },
  async updateWorkflow(id: string, input: WorkflowInput, version: number) {
    return request<Workflow>(
      `/workflows/${id}`,
      json("PATCH", { ...input, version }),
    );
  },
  async deleteWorkflow(id: string) {
    return request<{ ok: true }>(`/workflows/${id}`, json("DELETE"));
  },
  async executeWorkflow(id: string) {
    return request<WorkflowRunSummary>(`/workflows/${id}/execute`, json("POST"));
  },
  async workflowRun(id: string) {
    return request<WorkflowRunSummary>(`/workflows/runs/${id}`);
  },
  async credentials() {
    return demo ? [...demoCredentials] : request<Credential[]>("/credentials");
  },
  async createCredential(input: CredentialInput) {
    return request<Credential>("/credentials", json("POST", input));
  },
  async rotateCredential(id: string, input: CredentialInput, version: number) {
    return request<Credential>(
      `/credentials/${id}`,
      json("PATCH", { ...input, version }),
    );
  },
  async deleteCredential(id: string) {
    return request<{ ok: true }>(`/credentials/${id}`, json("DELETE"));
  },
  async maintenance() {
    return demo
      ? ([] as MaintenanceWindow[])
      : request<MaintenanceWindow[]>("/maintenance-windows");
  },
  async createMaintenance(input: MaintenanceInput) {
    return request<MaintenanceWindow>(
      "/maintenance-windows",
      json("POST", input),
    );
  },
  async updateMaintenance(
    id: string,
    input: MaintenanceInput,
    version: number,
  ) {
    return request<MaintenanceWindow>(
      `/maintenance-windows/${id}`,
      json("PATCH", { ...input, version }),
    );
  },
  async deleteMaintenance(id: string) {
    return request<{ ok: true }>(`/maintenance-windows/${id}`, json("DELETE"));
  },
  async agents() {
    return demo ? ([] as Agent[]) : request<Agent[]>("/agents");
  },
  async enrollAgent(name: string) {
    return request<{ id: string; enrollmentToken: string }>(
      "/agents/enroll",
      json("POST", { name }),
    );
  },
  async rotateAgent(id: string, rowVersion: number) {
    return request<{ enrollmentToken: string }>(
      `/agents/${id}/rotate`,
      json("POST", { rowVersion }),
    );
  },
  async revokeAgent(id: string, rowVersion: number) {
    return request<{ ok: true }>(
      `/agents/${id}`,
      json("DELETE", { rowVersion }),
    );
  },
  async roles() {
    return request<Role[]>("/admin/roles");
  },
  async createRole(
    input: Pick<Role, "name" | "permissions"> & { description?: string },
  ) {
    return request<Role>("/admin/roles", json("POST", input));
  },
  async updateRole(
    id: string,
    input: Pick<Role, "name" | "permissions" | "version"> & {
      description?: string | null;
    },
  ) {
    return request<Role>(`/admin/roles/${id}`, json("PATCH", input));
  },
  async deleteRole(id: string) {
    return request<{ ok: true }>(`/admin/roles/${id}`, json("DELETE"));
  },
  async users() {
    return request<User[]>("/admin/users");
  },
  async createUser(input: {
    email: string;
    displayName: string;
    password: string;
    roleIds: string[];
  }) {
    return request<User>("/admin/users", json("POST", input));
  },
  async updateUser(
    id: string,
    input: {
      version: number;
      displayName: string;
      locale: "zh-CN" | "en-US";
      timezone: string;
      disabled: boolean;
      roleIds: string[];
    },
  ) {
    return request(`/admin/users/${id}`, json("PATCH", input));
  },
  async tokens() {
    return request<ApiToken[]>("/tokens");
  },
  async createToken(input: {
    name: string;
    scopes: string[];
    expiresAt?: string;
  }) {
    return request<{ id: string; token: string }>(
      "/tokens",
      json("POST", input),
    );
  },
  async revokeToken(id: string) {
    return request(`/tokens/${id}`, json("DELETE"));
  },
  async audit() {
    return demo
      ? ([] as AuditEvent[])
      : request<AuditEvent[]>("/admin/audit-events");
  },
  async logs(filters: RuntimeLogFilters) {
    if (demo) return { items: [], nextCursor: null } as RuntimeLogPage;
    const params = new URLSearchParams();
    params.set("source", filters.source);
    params.set("status", filters.status);
    if (filters.monitorId) params.set("monitorId", filters.monitorId);
    if (filters.runId) params.set("runId", filters.runId);
    if (filters.search) params.set("search", filters.search);
    if (filters.cursor) params.set("cursor", filters.cursor);
    params.set("limit", String(filters.limit ?? 50));
    return request<RuntimeLogPage>(`/logs?${params.toString()}`);
  },
  async settings() {
    return request<Setting[]>("/admin/settings");
  },
  async saveSettings(
    settings: Array<{ key: string; value: unknown; version?: number }>,
  ) {
    return request<Setting[]>("/admin/settings", json("PUT", { settings }));
  },
};
