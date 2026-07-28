import { Controller, Get, Header, Inject } from "@nestjs/common";
import { CronExpressionParser } from "cron-parser";
import { IncidentStatus } from "@netsentinel/database";
import type {
  PublicStatusDay,
  PublicStatusSnapshot,
} from "@netsentinel/contracts";
import { Public } from "./auth.js";
import { PrismaService } from "./prisma.service.js";
import { mapPublicOverallStatus, mapPublicServiceStatus } from "./public-status-state.js";

function isWindowActive(
  window: {
    startsAt: Date | null;
    endsAt: Date | null;
    cron: string | null;
    durationMinutes: number | null;
    timezone: string;
  },
  now: Date,
): boolean {
  if (window.startsAt && window.endsAt && window.startsAt <= now && window.endsAt > now) return true;
  if (!window.cron || !window.durationMinutes) return false;
  try {
    const previous = CronExpressionParser.parse(window.cron, {
      currentDate: now,
      tz: window.timezone,
    }).prev().toDate();
    return previous.getTime() + window.durationMinutes * 60_000 > now.getTime();
  } catch {
    return false;
  }
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function availability(successCount: number, failureCount: number): number | null {
  const total = successCount + failureCount;
  return total ? Number(((successCount / total) * 100).toFixed(3)) : null;
}

function historyStatus(uptimePercent: number | null): PublicStatusDay["status"] {
  if (uptimePercent === null) return "NO_DATA";
  if (uptimePercent === 100) return "OPERATIONAL";
  if (uptimePercent >= 99) return "DEGRADED";
  return "OUTAGE";
}

function safeString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function safeSupportUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

@Public()
@Controller("public/status")
export class PublicStatusController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=15, stale-while-revalidate=45")
  async snapshot(): Promise<PublicStatusSnapshot> {
    const now = new Date();
    const settings = await this.prisma.setting.findMany({
      where: {
        key: {
          in: [
            "statusPageEnabled",
            "statusPageTitle",
            "statusPageDescription",
            "statusPageSupportUrl",
            "themeColor",
          ],
        },
      },
    });
    const setting = new Map(settings.map((item) => [item.key, item.value]));
    const enabled = setting.get("statusPageEnabled") !== false;
    if (!enabled) return { enabled: false, generatedAt: now.toISOString() };

    const monitors = await this.prisma.monitor.findMany({
      where: { publicStatusEnabled: true, publicDisplayName: { not: null } },
      select: {
        id: true,
        publicDisplayName: true,
        publicGroup: true,
        publicOrder: true,
        status: true,
        enabled: true,
      },
      orderBy: [
        { publicGroup: "asc" },
        { publicOrder: "asc" },
        { publicDisplayName: "asc" },
      ],
    });
    const monitorIds = monitors.map((monitor) => monitor.id);
    const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 89));
    const [metrics, windows, incidents] = await Promise.all([
      this.prisma.statusDailyMetric.findMany({
        where: { monitorId: { in: monitorIds }, day: { gte: firstDay } },
      }),
      this.prisma.maintenanceWindow.findMany({
        where: {
          enabled: true,
          OR: [{ monitorId: { in: monitorIds } }, { monitorId: null }],
        },
        select: {
          monitorId: true,
          startsAt: true,
          endsAt: true,
          cron: true,
          durationMinutes: true,
          timezone: true,
        },
      }),
      this.prisma.incident.findMany({
        where: {
          monitorId: { in: monitorIds },
          OR: [{ openedAt: { gte: firstDay } }, { status: { not: IncidentStatus.RESOLVED } }],
        },
        select: {
          id: true,
          monitorId: true,
          status: true,
          openedAt: true,
          resolvedAt: true,
        },
        orderBy: { openedAt: "desc" },
        take: 20,
      }),
    ]);

    const days = Array.from({ length: 90 }, (_, index) => {
      const day = new Date(firstDay);
      day.setUTCDate(firstDay.getUTCDate() + index);
      return day;
    });
    const metricsByMonitor = new Map<string, Map<string, { successCount: number; failureCount: number }>>();
    for (const metric of metrics) {
      const monitorMetrics = metricsByMonitor.get(metric.monitorId) ?? new Map();
      monitorMetrics.set(dateKey(metric.day), metric);
      metricsByMonitor.set(metric.monitorId, monitorMetrics);
    }
    const activeGlobalMaintenance = windows.some((window) => !window.monitorId && isWindowActive(window, now));
    const serviceRows = monitors.map((monitor) => {
      const monitorMetrics = metricsByMonitor.get(monitor.id) ?? new Map();
      const history = days.map((day): PublicStatusDay => {
        const metric = monitorMetrics.get(dateKey(day));
        const uptimePercent = metric ? availability(metric.successCount, metric.failureCount) : null;
        return { date: dateKey(day), status: historyStatus(uptimePercent), uptimePercent };
      });
      const totals = [...monitorMetrics.values()].reduce(
        (sum, metric) => ({
          success: sum.success + metric.successCount,
          failure: sum.failure + metric.failureCount,
        }),
        { success: 0, failure: 0 },
      );
      const inMaintenance = activeGlobalMaintenance || windows.some(
        (window) => window.monitorId === monitor.id && isWindowActive(window, now),
      );
      return {
        group: monitor.publicGroup,
        service: {
          id: monitor.id,
          name: monitor.publicDisplayName!,
          status: mapPublicServiceStatus(monitor.status, inMaintenance || !monitor.enabled),
          uptimePercent: availability(totals.success, totals.failure),
          history,
        },
      };
    });
    const grouped = new Map<string, typeof serviceRows[number]["service"][]>();
    for (const row of serviceRows) grouped.set(row.group, [...(grouped.get(row.group) ?? []), row.service]);
    const publicNames = new Map(monitors.map((monitor) => [monitor.id, monitor.publicDisplayName!]));
    const themeColor = safeString(setting.get("themeColor"), "sky", 20);

    return {
      enabled: true,
      generatedAt: now.toISOString(),
      title: safeString(setting.get("statusPageTitle"), "NetSentinel Status", 80),
      description: safeString(setting.get("statusPageDescription"), "", 300),
      supportUrl: safeSupportUrl(setting.get("statusPageSupportUrl")),
      themeColor,
      overallStatus: serviceRows.every((row) => row.service.uptimePercent === null && row.service.status === "UNKNOWN")
        ? "NO_DATA"
        : mapPublicOverallStatus(serviceRows.map((row) => row.service.status)),
      groups: [...grouped.entries()].map(([name, services]) => ({ name, services })),
      incidents: incidents.map((incident) => ({
        id: incident.id,
        serviceName: publicNames.get(incident.monitorId) ?? "Service",
        status: incident.status === IncidentStatus.RESOLVED ? "RESOLVED" : "ACTIVE",
        startedAt: incident.openedAt.toISOString(),
        resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      })),
    };
  }
}
