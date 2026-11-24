import { isIP } from "node:net";
import { z } from "zod";
import { decryptSecret, encryptSecret, type SecretEnvelope } from "@netsentinel/core";
import type { EntityRow } from "../storage/model.js";
import type { Store, UnitOfWork } from "../storage/store.js";
import { emailSchema } from "./account-name.js";

export const MAIL_SETTING = "__mailService";
const hostname = z.string().trim().toLowerCase().max(253).refine((value) => Boolean(isIP(value)) || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value));
export const mailFields = z.object({ enabled: z.boolean(), host: hostname, port: z.number().int().min(1).max(65535), tls: z.enum(["starttls", "implicit"]), user: z.string().trim().max(254), password: z.string().max(1024).optional(), from: emailSchema });
const storedMail = mailFields.extend({ password: z.string().max(1024) }).refine((input) => Boolean(input.user) === Boolean(input.password));
export type MailConfig = z.infer<typeof storedMail>;
export function decodeMail(value: unknown, key: Buffer): MailConfig {
  return storedMail.parse(JSON.parse(decryptSecret(value as SecretEnvelope, key, MAIL_SETTING)));
}
export const encodeMail = (config: MailConfig, key: Buffer) => encryptSecret(JSON.stringify(config), key, MAIL_SETTING) as unknown as EntityRow<"Setting">["value"];
export async function readMail(store: Store | UnitOfWork, key: Buffer) {
  const setting = await store.get("Setting", MAIL_SETTING);
  return setting ? decodeMail(setting.value, key) : null;
}
export function mergeMail(input: z.infer<typeof mailFields>, previous: MailConfig | null): MailConfig {
  const sameServer = previous && previous.host === input.host && previous.port === input.port && previous.tls === input.tls && previous.user === input.user;
  const result = storedMail.safeParse({ ...input, password: input.user ? input.password || (sameServer ? previous.password : "") : "" });
  if (!result.success) throw new Error("MAIL_CREDENTIAL_REQUIRED");
  return result.data;
}
export const smtpOptions = ({ host, port, tls, user, password, from }: MailConfig) => ({ host, port, secure: tls === "implicit", requireTLS: tls === "starttls", user, password, from });
export function mailView(config: MailConfig | null) {
  if (!config) return { enabled: false, host: "", port: 587, tls: "starttls" as const, user: "", from: "", passwordConfigured: false };
  const { password, ...view } = config;
  return { ...view, passwordConfigured: Boolean(password) };
}
