import WebSocket from "ws";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const serverUrl = process.env.NETSENTINEL_SERVER_URL ?? "";
const agentId = process.env.NETSENTINEL_AGENT_ID ?? "";
const credentialFile = process.env.NETSENTINEL_AGENT_CREDENTIAL_FILE ?? "/var/lib/netsentinel-agent/credential";
let token = existsSync(credentialFile) ? readFileSync(credentialFile, "utf8").trim() : (process.env.NETSENTINEL_AGENT_TOKEN ?? "");
if (!serverUrl || !agentId || !token) throw new Error("NETSENTINEL_SERVER_URL, NETSENTINEL_AGENT_ID and an enrollment token are required");

interface Command { requestId: string; command: string; timeoutMs: number }
interface Result { type: "result"; requestId: string; status: "SUCCEEDED" | "FAILED" | "UNKNOWN"; output?: string; error?: string }
const cap = (value: string) => value.slice(-64 * 1024);

async function execute(input: Command): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", input.command], { shell: false, env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" } });
    let output = ""; let settled = false;
    const finish = (result: Result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ type: "result", requestId: input.requestId, status: "UNKNOWN", error: "Command timed out" }); }, input.timeoutMs);
    child.stdout.on("data", (data: Buffer) => { output = cap(output + data.toString("utf8")); });
    child.stderr.on("data", (data: Buffer) => { output = cap(output + data.toString("utf8")); });
    child.once("error", () => finish({ type: "result", requestId: input.requestId, status: "FAILED", error: "Command could not start" }));
    child.once("close", (code) => finish(code === 0 ? { type: "result", requestId: input.requestId, status: "SUCCEEDED", output } : { type: "result", requestId: input.requestId, status: "FAILED", output, error: `Command exited with ${code}` }));
  });
}

let retryMs = 1_000;
function connect(): void {
  const socket = new WebSocket(serverUrl, { headers: { "x-agent-id": agentId, authorization: `Bearer ${token}` }, maxPayload: 128 * 1024 });
  let heartbeat: NodeJS.Timeout | undefined;
  socket.on("open", () => {
    retryMs = 1_000;
    heartbeat = setInterval(() => socket.send(JSON.stringify({ type: "heartbeat", version: "0.1.0" })), 15_000);
  });
  socket.on("message", async (payload) => {
    let command: Command & { type?: string; token?: string };
    try { command = JSON.parse(payload.toString()) as typeof command; } catch { return; }
    if (command.type === "enrolled" && command.token) { token = command.token; mkdirSync(dirname(credentialFile), { recursive: true }); writeFileSync(credentialFile, `${token}\n`, { encoding: "utf8", mode: 0o600 }); return; }
    if (!command.requestId || !command.command || !Number.isFinite(command.timeoutMs)) return;
    socket.send(JSON.stringify(await execute(command)));
  });
  socket.on("close", () => {
    if (heartbeat) clearInterval(heartbeat);
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  });
  socket.on("error", () => socket.close());
}
connect();
