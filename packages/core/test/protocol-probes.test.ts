import { createServer } from "node:net";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { runIcmpProbe, runTcpProbe, runWebSocketProbe } from "../src/index.js";

const closers: Array<() => void> = [];
const loopback = async () => ({ address: "127.0.0.1", family: 4 as const });
afterEach(() => closers.splice(0).forEach((close) => close()));

describe("TCP probe", () => {
  it("reports a successful connection", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => server.close());
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const result = await runTcpProbe({ host: "127.0.0.1", port: address.port, timeoutMs: 1_000 }, loopback);
    expect(result.ok).toBe(true);
  });

  it("does not connect when the target is not authorized", async () => {
    const result = await runTcpProbe(
      { host: "blocked.example.test", port: 443, timeoutMs: 1_000 },
      async () => null,
    );
    expect(result).toMatchObject({ ok: false, errorCode: "TARGET_BLOCKED" });
  });
});

describe("WebSocket probe", () => {
  it("sends a message and validates the response", async () => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    closers.push(() => server.close());
    server.on("connection", (socket) => socket.on("message", () => socket.send(JSON.stringify({ state: "ready" }))));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const result = await runWebSocketProbe({
      url: `ws://127.0.0.1:${address.port}`, timeoutMs: 1_000, verifyTls: true,
      send: "health", textContains: "ready",
    }, loopback);
    expect(result.ok).toBe(true);
  });

  it("sends custom handshake headers and can wait for pong", async () => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    closers.push(() => server.close());
    let authorization = "";
    server.on("connection", (_socket, request) => { authorization = request.headers.authorization ?? ""; });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");

    const result = await runWebSocketProbe({
      url: `ws://127.0.0.1:${address.port}`, timeoutMs: 1_000, verifyTls: true,
      headers: { authorization: "Bearer ws-token" }, expect: "PONG",
    }, loopback);

    expect(result.ok).toBe(true);
    expect(authorization).toBe("Bearer ws-token");
  });
});

describe("ICMP probe", () => {
  it("uses the bounded ping boundary and reports latency", async () => {
    const result = await runIcmpProbe({ host: "10.0.0.1", timeoutMs: 1_000 }, async () => ({ address: "10.0.0.1", family: 4 }), async () => ({ ok: true, latencyMs: 12 }));
    expect(result).toEqual({ ok: true, latencyMs: 12 });
  });
});
