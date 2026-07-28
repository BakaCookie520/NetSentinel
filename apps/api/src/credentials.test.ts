import { describe, expect, it, vi } from "vitest";
import { decryptSecret, type SecretEnvelope } from "@netsentinel/core";
import { CredentialsController } from "./controllers.js";

describe("WS token credentials", () => {
  it("encrypts structured WS token data and does not return plaintext", async () => {
    const key = Buffer.alloc(32, 7);
    process.env.NETSENTINEL_MASTER_KEY = key.toString("base64");
    let encrypted: unknown;
    let credentialId = "";
    const prisma = {
      credential: {
        create: vi.fn(async ({ data }: { data: { id: string; name: string; type: string; encrypted: unknown } }) => {
          credentialId = data.id;
          encrypted = data.encrypted;
          return {
            id: data.id,
            name: data.name,
            type: data.type,
            version: 1,
            createdAt: new Date(),
          };
        }),
      },
    };
    const controller = new CredentialsController(prisma as never);

    const result = await controller.create({
      name: "Events",
      type: "WS_TOKEN",
      token: "secret-token",
      placement: "QUERY",
      queryParamName: "access_token",
    });

    const plaintext = decryptSecret(
      encrypted as SecretEnvelope,
      key,
      credentialId,
    );
    expect(JSON.parse(plaintext)).toEqual({
      token: "secret-token",
      placement: "QUERY",
      queryParamName: "access_token",
    });
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("encrypted");
  });

  it("rejects rotating an HTTP-referenced credential to WS_TOKEN", async () => {
    process.env.NETSENTINEL_MASTER_KEY = Buffer.alloc(32, 8).toString("base64");
    const prisma = {
      credential: {
        findUnique: vi.fn(async () => ({
          monitors: [{ type: "HTTP" }],
          steps: [],
        })),
        updateMany: vi.fn(),
      },
    };
    const controller = new CredentialsController(prisma as never);

    await expect(
      controller.rotate("credential-1", {
        name: "Events",
        type: "WS_TOKEN",
        token: "secret-token",
        placement: "BEARER",
        queryParamName: "access_token",
        version: 1,
      }),
    ).rejects.toThrow("incompatible with an existing reference");
    expect(prisma.credential.updateMany).not.toHaveBeenCalled();
  });
});

describe("SSH key credentials", () => {
  it("encrypts the private key and optional passphrase as structured data", async () => {
    const key = Buffer.alloc(32, 9);
    process.env.NETSENTINEL_MASTER_KEY = key.toString("base64");
    let encrypted: unknown;
    let credentialId = "";
    const prisma = {
      credential: {
        create: vi.fn(async ({ data }: { data: { id: string; name: string; type: string; encrypted: unknown } }) => {
          credentialId = data.id;
          encrypted = data.encrypted;
          return {
            id: data.id,
            name: data.name,
            type: data.type,
            version: 1,
            createdAt: new Date(),
          };
        }),
      },
    };
    const controller = new CredentialsController(prisma as never);

    const result = await controller.create({
      name: "Encrypted deploy key",
      type: "SSH_KEY",
      secret: "private-key",
      passphrase: "key-passphrase",
    });

    const plaintext = decryptSecret(
      encrypted as SecretEnvelope,
      key,
      credentialId,
    );
    expect(JSON.parse(plaintext)).toEqual({
      privateKey: "private-key",
      passphrase: "key-passphrase",
    });
    expect(result).not.toHaveProperty("secret");
    expect(result).not.toHaveProperty("passphrase");
    expect(result).not.toHaveProperty("encrypted");
  });

  it("omits an empty passphrase from encrypted SSH key data", async () => {
    const key = Buffer.alloc(32, 10);
    process.env.NETSENTINEL_MASTER_KEY = key.toString("base64");
    let encrypted: unknown;
    let credentialId = "";
    const prisma = {
      credential: {
        create: vi.fn(async ({ data }: { data: { id: string; name: string; type: string; encrypted: unknown } }) => {
          credentialId = data.id;
          encrypted = data.encrypted;
          return { id: data.id, name: data.name, type: data.type, version: 1, createdAt: new Date() };
        }),
      },
    };
    const controller = new CredentialsController(prisma as never);

    await controller.create({
      name: "Deploy key",
      type: "SSH_KEY",
      secret: "private-key",
    });

    expect(JSON.parse(decryptSecret(encrypted as SecretEnvelope, key, credentialId))).toEqual({
      privateKey: "private-key",
    });
  });
});
