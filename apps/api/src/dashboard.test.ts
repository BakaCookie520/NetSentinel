import { describe, expect, it, vi } from "vitest";
import { DashboardController } from "./controllers.js";

function createPrisma(latencyRows: Array<{ bucket: Date; p50Ms: number }> = []) {
  return {
    monitor: { findMany: vi.fn(async () => []) },
    incident: { count: vi.fn(async () => 0) },
    approval: { count: vi.fn(async () => 0) },
    probeResult: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => latencyRows),
  };
}

describe("DashboardController", () => {
  it("returns an empty latency trend when there are no probe results", async () => {
    const controller = new DashboardController(createPrisma() as never);

    const result = await controller.get();

    expect(result.latencyTrend).toEqual([]);
  });

  it("serializes real P50 latency buckets", async () => {
    const bucket = new Date("2026-07-27T01:00:00.000Z");
    const controller = new DashboardController(
      createPrisma([{ bucket, p50Ms: 87.5 }]) as never,
    );

    const result = await controller.get();

    expect(result.latencyTrend).toEqual([
      { bucket: bucket.toISOString(), p50Ms: 87.5 },
    ]);
  });
});
