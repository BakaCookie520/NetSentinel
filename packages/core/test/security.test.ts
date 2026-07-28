import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, renderCommandTemplate } from "../src/index.js";

describe("credential encryption", () => {
  it("round-trips a secret without placing plaintext in the envelope", () => {
    const key = Buffer.alloc(32, 7);
    const envelope = encryptSecret("ssh-password-value", key, "credential-42");
    expect(JSON.stringify(envelope)).not.toContain("ssh-password-value");
    expect(decryptSecret(envelope, key, "credential-42")).toBe("ssh-password-value");
  });

  it("rejects a different master key", () => {
    const envelope = encryptSecret("secret", Buffer.alloc(32, 1), "credential-42");
    expect(() => decryptSecret(envelope, Buffer.alloc(32, 2), "credential-42")).toThrow();
  });
});

describe("command templates", () => {
  it("shell-quotes approved event metadata", () => {
    const command = renderCommandTemplate("restart {monitor.name}", {
      monitor: { name: "db; rm -rf /", target: "db.internal" },
      incident: { id: "inc-1" },
      event: { type: "DOWN" },
    });
    expect(command).toBe("restart 'db; rm -rf /'");
  });

  it("rejects response bodies and unknown fields", () => {
    expect(() => renderCommandTemplate("echo {response.body}", {
      monitor: { name: "db", target: "db.internal" },
      incident: { id: "inc-1" },
      event: { type: "DOWN" },
    })).toThrow("Template variable is not allowed");
  });
});
