import { describe, expect, it } from "vitest";
import { MonitorStatus } from "@netsentinel/database";
import { PublicStatusController } from "./public-status.controller.js";
import { mapPublicOverallStatus, mapPublicServiceStatus } from "./public-status-state.js";

describe("public status mapping", () => {
  it("maps internal monitor states without exposing details", () => {
    expect(mapPublicServiceStatus(MonitorStatus.UP, false)).toBe("OPERATIONAL");
    expect(mapPublicServiceStatus(MonitorStatus.DOWN, true)).toBe("MAINTENANCE");
    expect(mapPublicServiceStatus(MonitorStatus.PAUSED, false)).toBe("MAINTENANCE");
  });

  it("distinguishes partial and complete outages", () => {
    expect(mapPublicOverallStatus(["OPERATIONAL", "OUTAGE"])).toBe("PARTIAL_OUTAGE");
    expect(mapPublicOverallStatus(["OUTAGE", "OUTAGE"])).toBe("MAJOR_OUTAGE");
    expect(mapPublicOverallStatus([])).toBe("NO_DATA");
    expect(mapPublicOverallStatus(["UNKNOWN", "UNKNOWN"])).toBe("NO_DATA");
  });

  it("returns a privacy-safe snapshot", async () => {
    const prisma = {
      setting: { findMany: async () => [{ key: "statusPageEnabled", value: true }] },
      monitor: { findMany: async () => [{ id: "monitor-1", name: "Private internal name", publicDisplayName: "Public API", publicGroup: "Services", publicOrder: 0, status: MonitorStatus.UP, enabled: true }] },
      statusDailyMetric: { findMany: async () => [] },
      maintenanceWindow: { findMany: async () => [] },
      incident: { findMany: async () => [{ id: "incident-1", monitorId: "monitor-1", status: "OPEN", openedAt: new Date("2026-07-27T00:00:00.000Z"), resolvedAt: null, title: "secret internal title" }] },
    };
    const snapshot = await new PublicStatusController(prisma as never).snapshot();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain("Public API");
    expect(serialized).not.toContain("Private internal name");
    expect(serialized).not.toContain("secret internal title");
    expect(serialized).not.toContain("target");
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("workflow");
    expect(serialized).not.toContain("errorMessage");
  });
});
