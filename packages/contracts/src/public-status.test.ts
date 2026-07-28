import { describe, expect, it } from "vitest";
import { monitorInputSchema, publicMonitorConfigSchema } from "./index.js";

describe("public monitor configuration", () => {
  it("defaults new monitors to private", () => {
    expect(publicMonitorConfigSchema.parse({}).enabled).toBe(false);
  });

  it("requires a display name when public", () => {
    expect(publicMonitorConfigSchema.safeParse({ enabled: true, group: "API", order: 0 }).success).toBe(false);
  });

  it("is part of every typed monitor input", () => {
    const parsed = monitorInputSchema.parse({
      name: "API",
      type: "HTTP",
      target: "https://example.com/health",
      config: { method: "GET", headers: {}, expectedStatusMin: 200, expectedStatusMax: 299, verifyTls: true },
    });
    expect(parsed.publicStatus).toEqual({ enabled: false, group: "服务状态", order: 0 });
  });
});
