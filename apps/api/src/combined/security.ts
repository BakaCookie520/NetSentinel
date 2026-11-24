import { randomBytes, createHmac, timingSafeEqual, createHash } from "node:crypto";
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { encryptSecret, decryptSecret, type SecretEnvelope } from "@netsentinel/core";
import type { Store, UnitOfWork } from "../storage/store.js";
import type { EntityRow } from "../storage/model.js";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const passwordHash = (value: string) => hash(value, { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
export const passwordMatches = (encoded: string, value: string) => verify(encoded, value);
export const recoveryKey = () => randomBytes(32).toString("base64url");
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function totpSecret(): string {
  const buffer = randomBytes(20); let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  return bits.match(/.{5}/gu)!.map((part) => alphabet[Number.parseInt(part, 2)]).join("");
}
export function totpCode(secret: string, counter = Math.floor(Date.now() / 30000)): string {
  const binary = [...secret].map((char) => {
    const index = alphabet.indexOf(char); if (index < 0) throw new Error("TOTP_SECRET_INVALID");
    return index.toString(2).padStart(5, "0");
  }).join("");
  const key = Buffer.from(binary.match(/.{8}/gu)!.map((part) => Number.parseInt(part, 2)));
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac("sha1", key).update(message).digest();
  const offset = hash[19]! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
export function verifyTotp(secret: string, code: string, previous = -1, time = Date.now()): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const counter = Math.floor(time / 30000);
  for (const delta of [-1, 0, 1]) {
    const candidate = counter + delta;
    if (candidate > previous && timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(code))) return candidate;
  }
  return null;
}
export function newRecovery() { const key = recoveryKey(); return { key, hash: digest(key) }; }
export function newBackupCodes() {
  const codes = Array.from({ length: 10 }, () => randomBytes(10).toString("hex"));
  return { codes, hashes: codes.map(digest) };
}
export interface Identity {
  id: string; email: string | null; username: string | null; emailVerified: boolean; displayName: string; avatarUrl: string | null;
  permissions: string[]; authentication: "session" | "token"; forcePasswordChange: boolean;
  securitySetupRequired: boolean;
}
export async function identity(store: Store | UnitOfWork, user: EntityRow<"User">, authentication: Identity["authentication"] = "session", scopes?: string[]): Promise<Identity> {
  const links = await store.list("UserRole", { filters: [{ field: "userId", op: "eq", value: user.id }] });
  const granted = new Set<string>();
  for (const link of links) for (const permission of (await store.get("Role", link.roleId))?.permissions ?? []) granted.add(permission);
  return { id: user.id, email: user.email, username: user.username, emailVerified: user.emailVerified, displayName: user.displayName, avatarUrl: user.avatarKey ? `/api/v1/auth/me/avatar?v=${encodeURIComponent(user.avatarKey)}` : null,
    permissions: authentication === "token" ? (scopes ?? []).filter((scope) => granted.has(scope)) : [...granted],
    authentication, forcePasswordChange: user.forcePasswordChange, securitySetupRequired: !(await store.get("AccountSecurity", user.id))?.recoveryHash };
}
export async function issueSession(store: Store, userId: string, expectedPasswordHash?: string) {
  const raw = randomBytes(32).toString("base64url"); const csrf = randomBytes(24).toString("base64url");
  const user = await store.transaction(async (tx) => {
    const user = await tx.get("User", userId);
    if (!user || user.disabledAt || (expectedPasswordHash && user.passwordHash !== expectedPasswordHash)) throw new Error("AUTH_INVALID");
    await tx.put("Session", { idHash: digest(raw), userId, csrfHash: digest(csrf), expiresAt: new Date(Date.now() + 8 * 3600000).toISOString() });
    return user;
  });
  return { raw, csrfToken: csrf, user: await identity(store, user) };
}
export async function verifySecondFactor(tx: UnitOfWork, userId: string, code: string, key: Buffer) {
  const security = await tx.get("AccountSecurity", userId);
  if (!security?.totpEncrypted) throw new Error("AUTH_2FA_INVALID");
  const secret = decryptSecret(security.totpEncrypted as unknown as SecretEnvelope, key, userId);
  const counter = verifyTotp(secret, code, security.totpLastCounter);
  const backup = security.backupHashes.indexOf(digest(code));
  if (counter === null && backup < 0) throw new Error("AUTH_2FA_INVALID");
  await tx.put("AccountSecurity", { ...security, ...(counter !== null ? { totpLastCounter: counter } : { backupHashes: security.backupHashes.filter((_, index) => index !== backup) }) }, security.version);
}
export const encryptTotp = (secret: string, key: Buffer, userId: string) => encryptSecret(secret, key, userId) as unknown as EntityRow<"AccountSecurity">["totpEncrypted"];
