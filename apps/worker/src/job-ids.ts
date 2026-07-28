export function probeJobId(monitorId: string, scheduledAt: Date): string {
  return `${monitorId}-${scheduledAt.getTime()}`;
}
