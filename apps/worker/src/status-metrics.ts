export interface StatusMetricDelta {
  day: Date;
  successCount: 0 | 1;
  failureCount: 0 | 1;
}

export function statusMetricDelta(
  ok: boolean,
  maintenanceSuppressed: boolean,
  checkedAt: Date,
): StatusMetricDelta | null {
  if (maintenanceSuppressed) return null;
  return {
    day: new Date(Date.UTC(
      checkedAt.getUTCFullYear(),
      checkedAt.getUTCMonth(),
      checkedAt.getUTCDate(),
    )),
    successCount: ok ? 1 : 0,
    failureCount: ok ? 0 : 1,
  };
}
