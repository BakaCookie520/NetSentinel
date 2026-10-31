export type BackupSource = "manual" | "scheduled" | "import" | "protection";
export type BackupStatus = "running" | "ready" | "failed";
export interface BackupEntry {
  id: string;
  name: string;
  note: string;
  source: BackupSource;
  createdAt: string;
  status: BackupStatus;
  size: number;
  formatVersion: number;
  schemaFingerprint?: string;
  counts?: Record<string, number>;
  dataTime?: string;
  error?: string;
  // Wrapped with this instance's master key, never included in API responses.
  archivePassword?: unknown;
}
export interface BackupPolicy {
  enabled: boolean;
  frequency: "daily" | "weekly";
  time: string;
  weekday: number;
  timezone: string;
  retain: number;
  password?: unknown;
  lastSlot?: string;
}
export interface BackupJob {
  id: string;
  type: "create" | "import" | "restore";
  status: "running" | "succeeded" | "failed";
  phase: string;
  backupId?: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
}
export const BACKUP_LOCK = "netsentinel:backup:lock";
export const RESTORE_GATE = "netsentinel:restore:gate";
export const DEFAULT_POLICY: BackupPolicy = {
  enabled: false, frequency: "daily", time: "03:00", weekday: 0,
  timezone: "UTC", retain: 7,
};
