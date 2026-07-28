import { describe, expect, it } from "vitest";
import { credentialInputSchema, monitorInputSchema, workflowInputSchema } from "./index.js";

describe("typed configuration contracts", () => {
  it("accepts a complete HTTP monitor and rejects the wrong URL scheme", () => {
    const monitor = monitorInputSchema.parse({
      name: "Payments API",
      type: "HTTP",
      target: "https://pay.example.com/health",
      credentialId: "credential-1",
      intervalSeconds: 60,
      timeoutMs: 10_000,
      failureThreshold: 3,
      recoveryThreshold: 2,
      tagIds: [],
      config: { method: "POST", headers: { "x-client": "sentinel" }, body: "{}", expectedStatusMin: 200, expectedStatusMax: 204, verifyTls: true },
    });

    expect(monitor.type).toBe("HTTP");
    if (monitor.type !== "HTTP") throw new Error("Expected HTTP monitor");
    expect(monitor.config.method).toBe("POST");
    expect(() => monitorInputSchema.parse({ ...monitor, target: "ws://pay.example.com" })).toThrow();
    expect(() => monitorInputSchema.safeParse({ ...monitor, target: "not-a-url" })).not.toThrow();
    expect(monitorInputSchema.safeParse({ ...monitor, target: "not-a-url" }).success).toBe(false);
    expect(monitorInputSchema.safeParse({ ...monitor, config: {} }).success).toBe(false);
  });

  it("requires the selected WebSocket success condition configuration", () => {
    const base = { name: "Events", type: "WEBSOCKET", target: "wss://events.example.com", intervalSeconds: 60, timeoutMs: 10_000, failureThreshold: 3, recoveryThreshold: 2, tagIds: [] };
    expect(() => monitorInputSchema.parse({ ...base, config: { sendFormat: "NONE", expect: "MESSAGE", verifyTls: true } })).toThrow();
    const monitor = monitorInputSchema.parse({ ...base, config: { headers: {}, sendFormat: "TEXT", send: "ping", expect: "MESSAGE", textContains: "pong", verifyTls: true } });
    if (monitor.type !== "WEBSOCKET") throw new Error("Expected WebSocket monitor");
    expect(monitor.config.expect).toBe("MESSAGE");
  });

  it("validates every workflow action through one public schema", () => {
    const common = { name: "Recovery", trigger: "DOWN", approvalMode: "APPROVAL", approvalTimeoutMinutes: 15 };
    const steps = [
      { name: "Call API", type: "HTTP", credentialId: "http-credential", config: { url: "https://ops.example.com/recover", method: "POST", headers: {}, body: "{}", verifyTls: true } },
      { name: "SSH", type: "SSH", credentialId: "ssh-credential", config: { host: "host.example.com", port: 22, username: "ops", command: "systemctl restart app" } },
      { name: "Container", type: "SHELL", config: { command: "node health.js" } },
      { name: "Host", type: "AGENT_SHELL", config: { agentId: "agent-1", command: "systemctl restart app" } },
      { name: "Notify", type: "WEBHOOK", config: { url: "https://hooks.example.com/incident", method: "POST", headers: {}, verifyTls: true } },
      { name: "Email", type: "EMAIL", credentialId: "smtp-credential", config: { to: "ops@example.com", subject: "Incident", body: "Recovered" } },
    ];

    const workflow = workflowInputSchema.parse({ ...common, steps });
    expect(workflow.steps.map((step) => step.type)).toEqual(["HTTP", "SSH", "SHELL", "AGENT_SHELL", "WEBHOOK", "EMAIL"]);
  });

  it("accepts every SSH host key and strips legacy fingerprint settings", () => {
    const workflow = workflowInputSchema.parse({
      name: "Recovery",
      trigger: "MANUAL",
      approvalMode: "AUTO",
      approvalTimeoutMinutes: 15,
      steps: [{
        name: "Restart",
        type: "SSH",
        credentialId: "ssh-credential",
        config: {
          host: "host.example.com",
          port: 22,
          username: "ops",
          command: "systemctl restart app",
          hostKeySha256: "legacy-fingerprint",
        },
      }],
    });

    expect(workflow.steps[0]?.config).not.toHaveProperty("hostKeySha256");
  });

  it("accepts structured Basic, API key and SMTP credentials", () => {
    expect(credentialInputSchema.parse({ name: "Basic", type: "HTTP_BASIC", username: "api", password: "secret" }).type).toBe("HTTP_BASIC");
    const apiKey = credentialInputSchema.parse({ name: "Key", type: "HTTP_API_KEY", headerName: "X-API-Key", value: "secret" });
    if (apiKey.type !== "HTTP_API_KEY") throw new Error("Expected API key credential");
    expect(apiKey.headerName).toBe("X-API-Key");
    expect(credentialInputSchema.parse({ name: "Mail", type: "SMTP", host: "smtp.example.com", port: 587, secure: false, user: "ops", password: "secret", from: "ops@example.com" }).type).toBe("SMTP");
  });

  it("accepts SSH keys with or without a private-key passphrase", () => {
    const encrypted = credentialInputSchema.parse({
      name: "Encrypted deploy key",
      type: "SSH_KEY",
      secret: "-----BEGIN OPENSSH PRIVATE KEY-----",
      passphrase: "key-passphrase",
    });
    if (encrypted.type !== "SSH_KEY") throw new Error("Expected SSH key credential");
    expect(encrypted.passphrase).toBe("key-passphrase");

    const unencrypted = credentialInputSchema.parse({
      name: "Deploy key",
      type: "SSH_KEY",
      secret: "-----BEGIN OPENSSH PRIVATE KEY-----",
    });
    expect(unencrypted.type).toBe("SSH_KEY");
    expect(
      credentialInputSchema.safeParse({ name: "Empty", type: "SSH_KEY", secret: "" }).success,
    ).toBe(false);
  });

  it("accepts WS tokens with Bearer or configurable query placement", () => {
    const bearer = credentialInputSchema.parse({
      name: "Events Bearer",
      type: "WS_TOKEN",
      token: "secret",
      placement: "BEARER",
    });
    if (bearer.type !== "WS_TOKEN") throw new Error("Expected WS token credential");
    expect(bearer.queryParamName).toBe("access_token");

    const query = credentialInputSchema.parse({
      name: "Events Query",
      type: "WS_TOKEN",
      token: "secret",
      placement: "QUERY",
      queryParamName: "api_key",
    });
    expect(query.type).toBe("WS_TOKEN");
    expect(credentialInputSchema.safeParse({ ...query, token: "" }).success).toBe(false);
    expect(
      credentialInputSchema.safeParse({ ...query, queryParamName: "bad name" }).success,
    ).toBe(false);
  });
});
