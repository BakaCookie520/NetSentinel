import ssh2, { type ConnectConfig } from "ssh2";

const { utils: sshUtils } = ssh2;

const invalidSshKeyMessage =
  "CONFIG_INVALID: SSH private key or passphrase is invalid";

export type SshAuthentication =
  | { privateKey: string; passphrase?: string }
  | { password: string };

export function buildSshConnectionConfig(
  config: { host: unknown; port?: unknown; username: unknown },
  authentication: SshAuthentication,
  timeoutMs: number,
): ConnectConfig {
  return {
    host: String(config.host),
    port: Number(config.port ?? 22),
    username: String(config.username),
    readyTimeout: timeoutMs,
    ...authentication,
  };
}

export function materializeSshCredential(
  type: string,
  secret: string,
): SshAuthentication {
  if (type === "SSH_PASSWORD") return { password: secret };
  if (type !== "SSH_KEY" || !secret) throw new Error(invalidSshKeyMessage);

  const trimmed = secret.trimStart();
  if (!trimmed.startsWith("{")) return { privateKey: secret };

  try {
    const value = JSON.parse(secret) as {
      privateKey?: unknown;
      passphrase?: unknown;
    };
    if (
      typeof value.privateKey !== "string" ||
      !value.privateKey ||
      (value.passphrase !== undefined && typeof value.passphrase !== "string")
    ) {
      throw new Error();
    }
    return {
      privateKey: value.privateKey,
      ...(value.passphrase ? { passphrase: value.passphrase } : {}),
    };
  } catch {
    throw new Error(invalidSshKeyMessage);
  }
}

export function validateSshPrivateKey(
  privateKey: string,
  passphrase?: string,
): void {
  const parsed = sshUtils.parseKey(privateKey, passphrase);
  if (parsed instanceof Error) throw new Error(invalidSshKeyMessage);
}
