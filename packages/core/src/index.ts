import ipaddr from "ipaddr.js";
import type { MonitorState, Transition } from "@netsentinel/contracts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { JSONPath } from "jsonpath-plus";
import { Agent, fetch } from "undici";
import WebSocket from "ws";
import { RE2 } from "re2-wasm";

export interface StateAdvance {
  state: MonitorState;
  transition: Transition;
}

export interface StateThresholds {
  failures: number;
  successes: number;
}

const DEFAULT_THRESHOLDS: StateThresholds = { failures: 3, successes: 2 };

export function advanceMonitorState(
  current: MonitorState,
  successful: boolean,
  thresholds: StateThresholds = DEFAULT_THRESHOLDS,
): StateAdvance {
  if (current.status === "PAUSED") return { state: current, transition: null };

  if (successful) {
    const consecutiveSuccesses = current.consecutiveSuccesses + 1;
    const recovered = current.status === "DOWN" && consecutiveSuccesses >= thresholds.successes;
    return {
      state: {
        status: current.status === "DOWN" && !recovered ? "DOWN" : "UP",
        consecutiveFailures: 0,
        consecutiveSuccesses,
      },
      transition: recovered ? "RECOVERY" : null,
    };
  }

  const consecutiveFailures = current.consecutiveFailures + 1;
  const wentDown = current.status !== "DOWN" && consecutiveFailures >= thresholds.failures;
  return {
    state: {
      status: wentDown || current.status === "DOWN" ? "DOWN" : "DEGRADED",
      consecutiveFailures,
      consecutiveSuccesses: 0,
    },
    transition: wentDown ? "DOWN" : null,
  };
}

const BLOCKED_RANGES = new Set([
  "loopback",
  "linkLocal",
  "unspecified",
  "multicast",
  "broadcast",
  "reserved",
]);

export interface EgressPolicy { allow?: string[]; deny?: string[] }

function matchesCidr(address: ipaddr.IPv4 | ipaddr.IPv6, rule: string): boolean {
  try {
    const cidr = ipaddr.parseCIDR(rule);
    return address.kind() === cidr[0].kind() && address.match(cidr);
  } catch { return false; }
}

export function isAddressAllowed(address: string, policy: EgressPolicy = {}): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (policy.deny?.some((rule) => matchesCidr(parsed, rule))) return false;
  if (policy.allow?.some((rule) => matchesCidr(parsed, rule))) return true;
  return !BLOCKED_RANGES.has(parsed.range());
}

export interface SecretEnvelope {
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
}

function assertMasterKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("Master key must contain exactly 32 bytes");
}

export function encryptSecret(plaintext: string, key: Buffer, associatedData: string): SecretEnvelope {
  assertMasterKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptSecret(envelope: SecretEnvelope, key: Buffer, associatedData: string): string {
  assertMasterKey(key);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export interface CommandTemplateContext {
  monitor: { name: string; target: string };
  incident: { id: string };
  event: { type: string };
}

const TEMPLATE_VALUES: Record<string, (context: CommandTemplateContext) => string> = {
  "monitor.name": (context) => context.monitor.name,
  "monitor.target": (context) => context.monitor.target,
  "incident.id": (context) => context.incident.id,
  "event.type": (context) => context.event.type,
};

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderCommandTemplate(template: string, context: CommandTemplateContext): string {
  return template.replace(/\{([^{}]+)\}/g, (_match, variable: string) => {
    const getValue = TEMPLATE_VALUES[variable];
    if (!getValue) throw new Error(`Template variable is not allowed: ${variable}`);
    return quotePosix(getValue(context));
  });
}

export interface HttpProbeConfig {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  maxLatencyMs?: number;
  textContains?: string;
  regex?: string;
  jsonPath?: string;
  jsonPathExpected?: unknown;
  verifyTls: boolean;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
}

export type TargetAuthorizer = (hostname: string) => Promise<boolean>;

async function readBody(response: Response, limit = 64 * 1024): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Response body exceeded 64 KiB");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return new TextDecoder().decode(body);
}

function failed(startedAt: number, errorCode: string, errorMessage: string, statusCode?: number): ProbeResult {
  const base = { ok: false, latencyMs: Math.round(performance.now() - startedAt), errorCode, errorMessage };
  return statusCode === undefined ? base : { ...base, statusCode };
}

export async function runHttpProbe(config: HttpProbeConfig, authorize: TargetAuthorizer): Promise<ProbeResult> {
  const startedAt = performance.now();
  const dispatcher = new Agent({ connect: { rejectUnauthorized: config.verifyTls } });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let target = new URL(config.url);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!(await authorize(target.hostname))) return failed(startedAt, "TARGET_BLOCKED", "Target blocked by egress policy");
      const requestInit: Parameters<typeof fetch>[1] = {
        method: config.method,
        redirect: "manual",
        signal: controller.signal,
        dispatcher,
      };
      if (config.headers !== undefined) requestInit.headers = config.headers;
      if (config.body !== undefined) requestInit.body = config.body;
      response = await fetch(target, requestInit) as unknown as Response;
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) break;
      target = new URL(location, target);
      if (redirects === 5) return failed(startedAt, "TOO_MANY_REDIRECTS", "More than five redirects", response.status);
    }
    if (!response) return failed(startedAt, "NO_RESPONSE", "No response received");
    const latencyMs = Math.round(performance.now() - startedAt);
    if (response.status < config.expectedStatusMin || response.status > config.expectedStatusMax) {
      return failed(startedAt, "STATUS_ASSERTION_FAILED", "Unexpected HTTP status", response.status);
    }
    if (config.maxLatencyMs !== undefined && latencyMs > config.maxLatencyMs) {
      return failed(startedAt, "LATENCY_ASSERTION_FAILED", "Response exceeded maximum latency", response.status);
    }
    const needsBody = config.textContains !== undefined || config.regex !== undefined || config.jsonPath !== undefined;
    const body = needsBody ? await readBody(response) : "";
    if (config.textContains !== undefined && !body.includes(config.textContains)) {
      return failed(startedAt, "TEXT_ASSERTION_FAILED", "Response did not contain expected text", response.status);
    }
    if (config.regex !== undefined && !new RE2(config.regex, "u").test(body)) {
      return failed(startedAt, "REGEX_ASSERTION_FAILED", "Response did not match expected pattern", response.status);
    }
    if (config.jsonPath !== undefined) {
      let value: unknown;
      try { value = JSONPath({ path: config.jsonPath, json: JSON.parse(body), wrap: false }); }
      catch { return failed(startedAt, "JSON_ASSERTION_FAILED", "Response was not valid JSON for the configured JSONPath", response.status); }
      if (JSON.stringify(value) !== JSON.stringify(config.jsonPathExpected)) {
        return failed(startedAt, "JSON_ASSERTION_FAILED", "JSONPath value did not match", response.status);
      }
    }
    return { ok: true, latencyMs, statusCode: response.status };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Probe timed out" : "HTTP probe failed";
    return failed(startedAt, error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR", message);
  } finally {
    clearTimeout(timeout);
    await dispatcher.close();
  }
}

export interface TcpProbeConfig { host: string; port: number; timeoutMs: number }

export async function runTcpProbe(config: TcpProbeConfig, authorize: TargetAuthorizer): Promise<ProbeResult> {
  const startedAt = performance.now();
  if (!(await authorize(config.host))) return failed(startedAt, "TARGET_BLOCKED", "Target blocked by egress policy");
  return new Promise((resolve) => {
    let settled = false;
    const socket = createConnection({ host: config.host, port: config.port });
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(config.timeoutMs);
    socket.once("connect", () => finish({ ok: true, latencyMs: Math.round(performance.now() - startedAt) }));
    socket.once("timeout", () => finish(failed(startedAt, "TIMEOUT", "TCP probe timed out")));
    socket.once("error", () => finish(failed(startedAt, "NETWORK_ERROR", "TCP connection failed")));
  });
}

export interface WebSocketProbeConfig {
  url: string;
  timeoutMs: number;
  verifyTls: boolean;
  headers?: Record<string, string>;
  send?: string;
  textContains?: string;
  expect?: "HANDSHAKE" | "MESSAGE" | "PONG";
}

export async function runWebSocketProbe(config: WebSocketProbeConfig, authorize: TargetAuthorizer): Promise<ProbeResult> {
  const startedAt = performance.now();
  const target = new URL(config.url);
  if (!(await authorize(target.hostname))) return failed(startedAt, "TARGET_BLOCKED", "Target blocked by egress policy");
  return new Promise((resolve) => {
    let settled = false;
    const expected = config.expect ?? (config.textContains === undefined ? "HANDSHAKE" : "MESSAGE");
    const socket = new WebSocket(config.url, { rejectUnauthorized: config.verifyTls, followRedirects: false, headers: config.headers });
    const timer = setTimeout(() => finish(failed(startedAt, "TIMEOUT", "WebSocket probe timed out")), config.timeoutMs);
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    socket.once("open", () => {
      if (config.send !== undefined) socket.send(config.send);
      if (expected === "PONG") socket.ping();
      if (expected === "HANDSHAKE") finish({ ok: true, latencyMs: Math.round(performance.now() - startedAt) });
    });
    socket.on("message", (data) => {
      if (expected === "MESSAGE" && config.textContains !== undefined && data.toString().includes(config.textContains)) {
        finish({ ok: true, latencyMs: Math.round(performance.now() - startedAt) });
      }
    });
    socket.once("pong", () => { if (expected === "PONG") finish({ ok: true, latencyMs: Math.round(performance.now() - startedAt) }); });
    socket.once("unexpected-response", (_request, response) => finish(failed(startedAt, "HANDSHAKE_FAILED", "WebSocket handshake failed", response.statusCode)));
    socket.once("error", () => finish(failed(startedAt, "NETWORK_ERROR", "WebSocket connection failed")));
    socket.once("close", () => {
      if (!settled) finish(failed(startedAt, "MESSAGE_ASSERTION_FAILED", "WebSocket closed before the expected message"));
    });
  });
}

export interface IcmpProbeConfig { host: string; timeoutMs: number }
export type PingExecutor = (host: string, timeoutMs: number) => Promise<{ ok: boolean; latencyMs: number }>;

const defaultPingExecutor: PingExecutor = async (host, timeoutMs) => new Promise((resolve) => {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1_000));
  const child = spawn("ping", ["-c", "1", "-W", String(timeoutSeconds), "--", host], { shell: false });
  let output = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 250);
  child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-4_096); });
  child.once("error", () => { clearTimeout(timer); resolve({ ok: false, latencyMs: timeoutMs }); });
  child.once("close", (code) => {
    clearTimeout(timer);
    const match = /time[=<]([0-9.]+)\s*ms/u.exec(output);
    resolve({ ok: code === 0, latencyMs: match?.[1] ? Math.round(Number(match[1])) : timeoutMs });
  });
});

export async function runIcmpProbe(
  config: IcmpProbeConfig,
  authorize: TargetAuthorizer,
  executePing: PingExecutor = defaultPingExecutor,
): Promise<ProbeResult> {
  const startedAt = performance.now();
  if (!(await authorize(config.host))) return failed(startedAt, "TARGET_BLOCKED", "Target blocked by egress policy");
  const result = await executePing(config.host, config.timeoutMs);
  return result.ok ? result : { ok: false, latencyMs: result.latencyMs, errorCode: "ICMP_FAILED", errorMessage: "ICMP echo failed" };
}
