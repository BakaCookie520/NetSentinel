import { describe, expect, it } from "vitest";
import { probeJobId } from "./job-ids.js";

describe("probeJobId", () => {
  it("creates a stable BullMQ-compatible id", () => {
    const scheduledAt = new Date("2026-07-25T12:00:00.000Z");

    expect(probeJobId("monitor-1", scheduledAt)).toBe("monitor-1-1784980800000");
    expect(probeJobId("monitor-1", scheduledAt)).not.toContain(":");
  });
});
