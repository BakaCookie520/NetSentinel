import type { BackupGroup } from "@netsentinel/contracts";
import { ApiError, request, requestMultipart } from "./api";

export interface BackupEntry {
  id: string; name: string; note: string;
  source: "manual" | "scheduled" | "import" | "protection";
  createdAt: string; status: "running" | "ready" | "failed";
  size: number; formatVersion: number; schemaFingerprint?: string;
  groups?: BackupGroup[];
  counts?: Record<string, number>; dataTime?: string; error?: string;
}
export interface BackupPolicy {
  enabled: boolean; frequency: "daily" | "weekly"; time: string;
  weekday: number; timezone: string; retain: number; passwordConfigured: boolean;
  uploadMaxBytes: number;
  groups: BackupGroup[];
}
export interface BackupJob {
  id: string; type: "create" | "import" | "restore";
  status: "running" | "succeeded" | "failed"; phase: string;
  backupId?: string; error?: string; sessionReset?: boolean;
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export const backups = {
  list: () => request<BackupEntry[]>("/admin/backups"),
  policy: () => request<BackupPolicy>("/admin/backups/policy"),
  savePolicy: (policy: Omit<BackupPolicy, "passwordConfigured" | "uploadMaxBytes"> & { password?: string }) => request<BackupPolicy>("/admin/backups/policy", json("PUT", policy)),
  create: (name: string, note: string, groups: BackupGroup[]) => request<BackupJob>("/admin/backups", json("POST", { name, note, groups })),
  update: (id: string, name: string, note: string) => request<BackupEntry>(`/admin/backups/${id}`, json("PATCH", { name, note })),
  remove: (id: string) => request(`/admin/backups/${id}`, { method: "DELETE" }),
  job: (id: string) => request<BackupJob>(`/admin/backups/jobs/${id}`),
  import: (file: File, password: string, name: string) => {
    const body = new FormData(); body.append("file", file); body.append("password", password); body.append("name", name);
    return requestMultipart<BackupJob>("/admin/backups/import", body);
  },
  restore: (id: string, currentPassword: string, confirmation: string, groups: BackupGroup[]) => request<BackupJob>(`/admin/backups/${id}/restore`, json("POST", { currentPassword, confirmation, groups })),
  download: async (id: string, currentPassword: string) => {
    const response = await fetch(`/api/v1/admin/backups/${id}/download`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": sessionStorage.getItem("netsentinel.csrf") ?? "" },
      body: JSON.stringify({ currentPassword }),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { detail?: string };
      throw new ApiError(problem.detail ?? "BACKUP_OPERATION_FAILED", response.status);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url;
    link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/u)?.[1] ?? `netsentinel-${id}.nsbackup`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
