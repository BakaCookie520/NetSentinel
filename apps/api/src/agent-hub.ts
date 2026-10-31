import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Redis } from "ioredis";
import { digest } from "./auth.js";
import { PrismaService } from "./prisma.service.js";
import type { BackupRuntime } from "./backup-runtime.js";
import { RESTORE_GATE } from "./backup-types.js";

export function attachAgentHub(server: Server, prisma: PrismaService, runtime?: BackupRuntime): () => Promise<void> {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const sockets = new Map<string, WebSocket>();
  const connection = { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) };
  const subscriber = new Redis(connection);
  const publisher = new Redis(connection);

  server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/agent/v1/connect") return;
    if (runtime && await runtime.redis.exists(RESTORE_GATE)) { socket.destroy(); return; }
    const agentId = request.headers["x-agent-id"];
    const authorization = request.headers.authorization;
    if (typeof agentId !== "string" || !authorization?.startsWith("Bearer ")) { socket.destroy(); return; }
    const agent = await prisma.agent.findFirst({ where: { id: agentId, tokenHash: digest(authorization.slice(7)), revokedAt: null } });
    if (!agent) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, agentId));
  });

  wss.on("connection", async (socket: WebSocket, agentId: string) => {
    let release: (() => Promise<void>) | undefined;
    try { release = await runtime?.enterWrite(); } catch { socket.close(1013, "Restoring backup"); return; }
    try {
    sockets.get(agentId)?.close(4001, "Replaced by a newer connection");
    sockets.set(agentId, socket);
    const connectedAgent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    if (!connectedAgent.enrolledAt) {
      const persistentToken = randomBytes(32).toString("base64url");
      await prisma.agent.update({ where: { id: agentId }, data: { tokenHash: digest(persistentToken), enrolledAt: new Date(), status: "ONLINE", lastSeenAt: new Date() } });
      socket.send(JSON.stringify({ type: "enrolled", token: persistentToken }));
    } else await prisma.agent.update({ where: { id: agentId }, data: { status: "ONLINE", lastSeenAt: new Date() } });
    } catch { socket.close(1011, "Agent unavailable"); return; }
    finally { await release?.(); }
    socket.on("message", async (payload) => {
      // Results of already-running commands must be delivered while draining;
      // they do not mutate the database. Heartbeats/registration are fenced.
      if (runtime && await runtime.redis.exists(RESTORE_GATE)) {
        try {
          const message = JSON.parse(payload.toString()) as { type?: string; requestId?: string; status?: string; output?: string; error?: string };
          if (message.type === "result" && message.requestId) await publisher.publish(`netsentinel:agent:results:${message.requestId}`, JSON.stringify({ status: message.status, output: message.output, error: message.error }));
        } catch { /* Malformed external result. */ }
        return;
      }
      let release: (() => Promise<void>) | undefined;
      try { release = await runtime?.enterWrite(); } catch { socket.close(1013, "Restoring backup"); return; }
      try {
      let message: { type?: string; requestId?: string; status?: string; output?: string; error?: string; version?: string };
      try { message = JSON.parse(payload.toString()) as typeof message; } catch { return; }
      if (message.type === "heartbeat") await prisma.agent.update({ where: { id: agentId }, data: { lastSeenAt: new Date(), version: message.version } });
      if (message.type === "result" && message.requestId) await publisher.publish(`netsentinel:agent:results:${message.requestId}`, JSON.stringify({ status: message.status, output: message.output, error: message.error }));
      } catch { socket.close(1011, "Agent unavailable"); }
      finally { await release?.(); }
    });
    socket.on("close", async () => {
      let release: (() => Promise<void>) | undefined;
      try { release = await runtime?.enterWrite(); } catch { sockets.delete(agentId); return; }
      try {
      if (sockets.get(agentId) === socket) { sockets.delete(agentId); await prisma.agent.updateMany({ where: { id: agentId, revokedAt: null }, data: { status: "OFFLINE" } }); }
      } finally { await release?.(); }
    });
  });

  void subscriber.psubscribe("netsentinel:agent:commands:*");
  subscriber.on("pmessage", (_pattern, channel, message) => {
    const agentId = channel.split(":").at(-1);
    const socket = agentId ? sockets.get(agentId) : undefined;
    if (socket?.readyState === WebSocket.OPEN) socket.send(message);
  });

  void subscriber.subscribe("netsentinel:agents:disconnect");
  subscriber.on("message", (channel) => {
    if (channel === "netsentinel:agents:disconnect") for (const socket of sockets.values()) socket.close(1013, "Restoring backup");
  });

  return async () => { wss.close(); await Promise.all([subscriber.quit(), publisher.quit()]); };
}
