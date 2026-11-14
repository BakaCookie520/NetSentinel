import { spawn } from "node:child_process";
import { Client } from "ssh2";
import nodemailer from "nodemailer";
import { fetch } from "undici";
import { createPinnedDispatcher, renderCommandTemplate, type AuthorizedTarget } from "@netsentinel/core";
import { workflowStepInputSchema } from "@netsentinel/contracts";
import { materializeSshCredential, buildSshConnectionConfig, validateSshPrivateKey } from "./ssh-credentials.js";
import { buildCredentialHeaders, materializeWebSocketCredential, type HttpCredentialType, type WebSocketCredentialType } from "./credential-headers.js";

export { buildCredentialHeaders, materializeWebSocketCredential };
export type { HttpCredentialType, WebSocketCredentialType };
export interface ExecutionResult { status: "SUCCEEDED" | "FAILED" | "UNKNOWN"; output?: string; error?: string }
export interface ExecutionDependencies {
  authorize(host: string): Promise<AuthorizedTarget | null>;
  agent(id: string, command: string, timeout: number): Promise<ExecutionResult>;
}
const cap = (text: string) => text.slice(-65536);
async function commandProcess(command: string, timeout: number): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", command], { env: { PATH: process.env.PATH }, shell: false });
    let output = ""; let finished = false;
    const finish = (result: ExecutionResult) => { if (!finished) { finished = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ status: "UNKNOWN", error: "Command timed out; result uncertain" }); }, timeout);
    child.stdout.on("data", (chunk: Buffer) => { output = cap(output + chunk.toString()); });
    child.stderr.on("data", (chunk: Buffer) => { output = cap(output + chunk.toString()); });
    child.once("error", () => finish({ status: "FAILED", error: "Command could not start" }));
    child.once("close", (code) => finish(code === 0 ? { status: "SUCCEEDED", output } : { status: "FAILED", error: `Command exited ${code}`, output }));
  });
}
export async function executeAction(
  input: { name: string; type: string; config: unknown; timeoutMs: number; retries: number; continueOnFailure: boolean; credentialId: string | null },
  credential: { type: string; secret: string } | null,
  context: Parameters<typeof renderCommandTemplate>[1],
  dependencies: ExecutionDependencies,
): Promise<ExecutionResult> {
  const validation = workflowStepInputSchema.safeParse(input);
  if (!validation.success) return { status: "FAILED", error: "CONFIG_INVALID: incomplete action" };
  const step = validation.data;
  const config = step.config as Record<string, unknown>;
  const secret = credential?.secret ?? "";
  const command = renderCommandTemplate(String(config.command ?? ""), context);
  let result: ExecutionResult;
  try {
    if (step.type === "SHELL") result = await commandProcess(command, step.timeoutMs);
    else if (step.type === "AGENT_SHELL") result = await dependencies.agent(String(config.agentId), command, step.timeoutMs);
    else if (step.type === "SSH") {
      if (!credential || !["SSH_KEY", "SSH_PASSWORD"].includes(credential.type)) throw new Error("CONFIG_INVALID");
      const target = await dependencies.authorize(String(config.host));
      if (!target) return { status: "FAILED", error: "EGRESS_BLOCKED" };
      const authentication = materializeSshCredential(credential.type, secret);
      if ("privateKey" in authentication) validateSshPrivateKey(authentication.privateKey, authentication.passphrase);
      result = await new Promise((resolve) => {
        const client = new Client(); let output = ""; let finished = false;
        const finish = (value: ExecutionResult) => { if (!finished) { finished = true; clearTimeout(timer); client.end(); resolve(value); } };
        const timer = setTimeout(() => finish({ status: "UNKNOWN", error: "SSH timed out; result uncertain" }), step.timeoutMs);
        client.on("ready", () => client.exec(command, (error, stream) => {
          if (error) { finish({ status: "FAILED", error: "SSH command could not start" }); return; }
          stream.on("data", (chunk: Buffer) => { output = cap(output + chunk.toString()); });
          stream.stderr.on("data", (chunk: Buffer) => { output = cap(output + chunk.toString()); });
          stream.on("close", (code: number) => finish(code === 0 ? { status: "SUCCEEDED", output } : { status: "FAILED", output, error: `SSH exited ${code}` }));
        }));
        client.on("error", () => finish({ status: "UNKNOWN", error: "SSH disconnected; result uncertain" }));
        client.connect(buildSshConnectionConfig({ host: target.address, username: config.username, port: config.port }, authentication, step.timeoutMs));
      });
    } else if (step.type === "HTTP" || step.type === "WEBHOOK") {
      let url = new URL(String(config.url)); let method = String(config.method ?? "POST");
      let body = typeof config.body === "string" ? config.body : undefined;
      const authHeaders = credential ? buildCredentialHeaders(credential.type as HttpCredentialType, secret) : {};
      const headers = { ...(config.headers as Record<string, string> ?? {}), ...authHeaders, "idempotency-key": context.incident.id };
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), step.timeoutMs);
      result = { status: "FAILED", error: "Too many redirects" };
      try {
        for (let count = 0; count <= 5; count += 1) {
          const target = ["http:", "https:"].includes(url.protocol) ? await dependencies.authorize(url.hostname) : null;
          if (!target) { result = { status: "FAILED", error: "EGRESS_BLOCKED" }; break; }
          const dispatcher = createPinnedDispatcher(target, config.verifyTls !== false);
          try {
            const response = await fetch(url, { method, headers, ...(body && method !== "GET" && method !== "HEAD" ? { body } : {}), signal: controller.signal, redirect: "manual", dispatcher });
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (response.status >= 300 && response.status < 400 && location) {
              const previousOrigin = url.origin; url = new URL(location, url);
              if (previousOrigin !== url.origin) for (const key of Object.keys(headers)) if (key !== "idempotency-key") delete (headers as Record<string, string>)[key];
              if ([301, 302, 303].includes(response.status) && method !== "GET" && method !== "HEAD") { method = "GET"; body = undefined; }
              continue;
            }
            result = response.ok ? { status: "SUCCEEDED", output: `HTTP ${response.status}` } : { status: "FAILED", error: `HTTP ${response.status}` }; break;
          } finally { await dispatcher.close(); }
        }
      } finally { clearTimeout(timer); }
    } else {
      if (credential?.type !== "SMTP") throw new Error("CONFIG_INVALID");
      const smtp = JSON.parse(secret) as { host: string; port: number; secure: boolean; user: string; password: string; from: string };
      const target = await dependencies.authorize(smtp.host); if (!target) return { status: "FAILED", error: "EGRESS_BLOCKED" };
      const transport = nodemailer.createTransport({ host: target.address, port: smtp.port, secure: smtp.secure, tls: { servername: smtp.host }, connectionTimeout: step.timeoutMs, socketTimeout: step.timeoutMs, auth: { user: smtp.user, pass: smtp.password } });
      try { await transport.sendMail({ from: smtp.from, to: String(config.to), subject: String(config.subject), text: String(config.body) }); result = { status: "SUCCEEDED", output: "Email accepted" }; }
      finally { transport.close(); }
    }
  } catch { result = { status: "UNKNOWN", error: "Action failed; remote result may be uncertain" }; }
  return { ...result, ...(result.output ? { output: secret ? result.output.replaceAll(secret, "[REDACTED]") : result.output } : {}), ...(result.error ? { error: secret ? result.error.replaceAll(secret, "[REDACTED]") : result.error } : {}) };
}
