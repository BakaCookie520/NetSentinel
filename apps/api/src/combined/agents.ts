import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { digest } from "./security.js";
import type { ApplicationState } from "./setup.js";
import type { ExecutionResult } from "@netsentinel/worker/execution";
import { eq } from "./routes.js";

export function attachCombinedAgents(server: Server, state: ApplicationState) {
  const sockets = new Map<string, WebSocket>();
  const pending = new Map<string, { agentId: string; resolve(result: ExecutionResult): void; timer: ReturnType<typeof setTimeout> }>();
  const hub = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const command = async (agentId: string, command: string, timeoutMs: number): Promise<ExecutionResult> => {
    const socket = sockets.get(agentId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return { status: "FAILED", error: "Agent offline" };
    return new Promise((resolve) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ status: "UNKNOWN", error: "Agent timed out; result uncertain" }); }, timeoutMs + 1000);
      pending.set(requestId, { agentId, resolve, timer });
      socket.send(JSON.stringify({ requestId, command, timeoutMs }));
    });
  };
  const bind = () => {
    if (!state.runtime) return;
    state.runtime.agentCommand = command;
    state.runtime.events.on("agent.revoke", (id: string) => { sockets.get(id)?.close(4001, "Credential revoked"); sockets.delete(id); });
    state.runtime.events.on("agents.disconnect", () => { for (const socket of sockets.values()) socket.close(1013, "Restoring"); });
  };
  server.on("upgrade", async (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/agent/v1/connect") { socket.destroy(); return; }
    try {
      const id = request.headers["x-agent-id"]; const auth = request.headers.authorization;
      if (!state.config.state.initialized || !state.store || !state.runtime?.healthy || state.runtime.restoring || state.runtime.paused || typeof id !== "string" || !auth?.startsWith("Bearer ")) { socket.destroy(); return; }
      const agent = await state.store.get("Agent", id);
      if (!agent || agent.revokedAt || agent.tokenHash !== digest(auth.slice(7))) { socket.destroy(); return; }
      hub.handleUpgrade(request, socket, head, (websocket) => hub.emit("connection", websocket, id));
    } catch { socket.destroy(); }
  });
  hub.on("connection", async (socket: WebSocket, id: string) => {
    try {
      if (!state.store || state.runtime?.restoring || state.runtime?.paused) { socket.close(); return; }
      sockets.get(id)?.close(4001, "Replaced");
      sockets.set(id, socket);
      const agent = await state.store.get("Agent", id);
      if (!agent) { socket.close(); return; }
      const token = agent.enrolledAt ? null : randomBytes(32).toString("base64url");
      await state.store.transaction(async (tx) => {
        if (state.runtime?.paused || state.runtime?.restoring) throw new Error("RUNTIME_UNAVAILABLE");
        const current = await tx.get("Agent", id); if (!current || current.revokedAt) throw new Error("AUTH_INVALID");
        await tx.put("Agent", { ...current, status: "ONLINE", lastSeenAt: new Date().toISOString(), ...(token ? { tokenHash: digest(token), enrolledAt: new Date().toISOString() } : {}) });
      });
      if (token) socket.send(JSON.stringify({ type: "enrolled", token }));
    } catch { socket.close(1011); return; }
    socket.on("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; requestId?: string; status?: string; output?: string; error?: string; version?: string };
        if (message.type === "result" && message.requestId) {
          const result = pending.get(message.requestId);
          if (result?.agentId === id && ["SUCCEEDED", "FAILED", "UNKNOWN"].includes(message.status ?? "")) {
            clearTimeout(result.timer); pending.delete(message.requestId);
            result.resolve({ status: message.status as ExecutionResult["status"], output: message.output?.slice(-65536), error: message.error?.slice(-65536) });
          }
        }
        if (message.type === "heartbeat" && state.store && !state.runtime?.restoring && !state.runtime?.paused) await state.store.transaction(async (tx) => {
          if (state.runtime?.paused || state.runtime?.restoring) return;
          const current = await tx.get("Agent", id);
          if (!current || current.revokedAt) { socket.close(4001); return; }
          await tx.put("Agent", { ...current, lastSeenAt: new Date().toISOString(), version: message.version?.slice(0, 100) ?? null });
        });
      } catch { socket.close(1011); }
    });
    socket.on("close", () => {
      if (sockets.get(id) !== socket) return;
      sockets.delete(id);
      if (state.store && !state.runtime?.restoring && !state.runtime?.paused) void state.store.transaction(async (tx) => {
        if (state.runtime?.paused || state.runtime?.restoring) return;
        const current = await tx.get("Agent", id);
        if (current && !current.revokedAt) await tx.put("Agent", { ...current, status: "OFFLINE" });
      }).catch(() => undefined);
    });
  });
  return { bind, close: () => { for (const socket of sockets.values()) socket.close(); for (const result of pending.values()) { clearTimeout(result.timer); result.resolve({ status: "UNKNOWN", error: "Application stopped" }); } hub.close(); } };
}
