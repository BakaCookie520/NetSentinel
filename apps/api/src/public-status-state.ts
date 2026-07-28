import type { PublicOverallStatus, PublicServiceStatus } from "@netsentinel/contracts";

type InternalMonitorStatus = "UNKNOWN" | "UP" | "DEGRADED" | "DOWN" | "PAUSED";

export function mapPublicServiceStatus(
  status: InternalMonitorStatus,
  inMaintenance: boolean,
): PublicServiceStatus {
  if (inMaintenance || status === "PAUSED") return "MAINTENANCE";
  if (status === "UP") return "OPERATIONAL";
  if (status === "DEGRADED") return "DEGRADED";
  if (status === "DOWN") return "OUTAGE";
  return "UNKNOWN";
}

export function mapPublicOverallStatus(
  statuses: PublicServiceStatus[],
): PublicOverallStatus {
  if (!statuses.length) return "NO_DATA";
  if (statuses.every((status) => status === "MAINTENANCE")) return "MAINTENANCE";
  const observable = statuses.filter((status) => status !== "MAINTENANCE");
  if (observable.length && observable.every((status) => status === "UNKNOWN")) return "NO_DATA";
  if (observable.length && observable.every((status) => status === "OUTAGE")) return "MAJOR_OUTAGE";
  if (observable.includes("OUTAGE")) return "PARTIAL_OUTAGE";
  if (observable.includes("DEGRADED") || observable.includes("UNKNOWN")) return "DEGRADED";
  return "OPERATIONAL";
}
