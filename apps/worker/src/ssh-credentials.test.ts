import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSshConnectionConfig,
  materializeSshCredential,
  validateSshPrivateKey,
} from "./ssh-credentials.js";

describe("SSH credentials", () => {
  it("keeps legacy raw private-key credentials working", () => {
    expect(materializeSshCredential("SSH_KEY", "legacy-private-key")).toEqual({
      privateKey: "legacy-private-key",
    });
  });

  it("materializes structured encrypted private-key credentials", () => {
    expect(
      materializeSshCredential(
        "SSH_KEY",
        JSON.stringify({ privateKey: "private-key", passphrase: "key-passphrase" }),
      ),
    ).toEqual({ privateKey: "private-key", passphrase: "key-passphrase" });
  });

  it("materializes password credentials", () => {
    expect(materializeSshCredential("SSH_PASSWORD", "login-password")).toEqual({
      password: "login-password",
    });
  });

  it("validates a real encrypted private key with its passphrase", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const encryptedKey = privateKey.export({
      type: "pkcs1",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: "correct-passphrase",
    }).toString();

    expect(() => validateSshPrivateKey(encryptedKey, "correct-passphrase")).not.toThrow();
    expect(() => validateSshPrivateKey(encryptedKey, "wrong-passphrase")).toThrow(
      "CONFIG_INVALID: SSH private key or passphrase is invalid",
    );
  });

  it("rejects malformed structured key credentials", () => {
    expect(() => materializeSshCredential("SSH_KEY", JSON.stringify({ passphrase: "secret" }))).toThrow(
      "CONFIG_INVALID: SSH private key or passphrase is invalid",
    );
  });

  it("accepts every server host key by omitting a host verifier", () => {
    const config = buildSshConnectionConfig(
      { host: "host.example.com", port: 22, username: "ops" },
      { password: "secret" },
      10_000,
    );

    expect(config).not.toHaveProperty("hostVerifier");
    expect(config).toMatchObject({
      host: "host.example.com",
      port: 22,
      username: "ops",
      readyTimeout: 10_000,
    });
  });
});
