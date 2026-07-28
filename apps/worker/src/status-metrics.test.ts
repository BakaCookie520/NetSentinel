import { describe, expect, it } from "vitest";
import { statusMetricDelta } from "./status-metrics.js";

describe("statusMetricDelta", () => {
  it("uses UTC calendar boundaries", () => {
    const result = statusMetricDelta(true, false, new Date("2026-07-27T23:59:59.000Z"));
    expect(result).toEqual({
      day: new Date("2026-07-27T00:00:00.000Z"),
      successCount: 1,
      failureCount: 0,
    });
  });

  it("excludes maintenance-suppressed probes", () => {
    expect(statusMetricDelta(false, true, new Date())).toBeNull();
  });

  it("counts a failed probe once", () => {
    const result = statusMetricDelta(false, false, new Date("2026-07-27T00:00:00.000Z"));
    expect(result?.failureCount).toBe(1);
    expect(result?.successCount).toBe(0);
  });
});
