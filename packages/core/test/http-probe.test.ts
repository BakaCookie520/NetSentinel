import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runHttpProbe } from "../src/index.js";

const servers: ReturnType<typeof createServer>[] = [];
const loopback = async () => ({ address: "127.0.0.1", family: 4 as const });
afterEach(() => servers.splice(0).forEach((server) => server.close()));

describe("HTTP probe", () => {
  it("checks status, text and JSONPath through its public result", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ service: { state: "ready" }, message: "healthy" }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");

    const result = await runHttpProbe({
      url: `http://127.0.0.1:${address.port}/health`, method: "GET", timeoutMs: 1_000,
      expectedStatusMin: 200, expectedStatusMax: 299, textContains: "healthy",
      jsonPath: "$.service.state", jsonPathExpected: "ready", verifyTls: true,
    }, loopback);

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports an assertion failure without exposing the response body", async () => {
    const server = createServer((_request, response) => response.end("not ready"));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const result = await runHttpProbe({
      url: `http://127.0.0.1:${address.port}`, method: "GET", timeoutMs: 1_000,
      expectedStatusMin: 200, expectedStatusMax: 299, textContains: "healthy", verifyTls: true,
    }, loopback);
    expect(result).toMatchObject({ ok: false, errorCode: "TEXT_ASSERTION_FAILED" });
    expect(JSON.stringify(result)).not.toContain("not ready");
  });

  it("connects to the authorized address without resolving the URL hostname again", async () => {
    const server = createServer((_request, response) => response.end("healthy"));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const authorize = vi.fn(async (hostname: string) => {
      expect(hostname).toBe("rebinding.example.test");
      return { address: "127.0.0.1", family: 4 as const };
    });

    const result = await runHttpProbe({
      url: `http://rebinding.example.test:${address.port}/health`,
      method: "GET",
      timeoutMs: 1_000,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      verifyTls: true,
    }, authorize);

    expect(result.ok).toBe(true);
    expect(authorize).toHaveBeenCalledTimes(1);
  });
});
