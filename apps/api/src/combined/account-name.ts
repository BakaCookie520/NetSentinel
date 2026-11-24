import { z } from "zod";
import { digest } from "./security.js";
import type { Store } from "../storage/store.js";

const normalize = (value: string) => value.trim().normalize("NFKC").toLowerCase();
export const usernameSchema = z.string().max(120).transform(normalize)
  .pipe(z.string().min(1).max(120).regex(/^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u).refine((value) => !value.startsWith("legacy-")));
export const emailSchema = z.string().trim().max(254).email().transform((value) => value.toLowerCase());
const identifierSchema = z.string().trim().min(1).max(254);
// Accept the previous `email` wire field for existing clients.
export const loginFields = { identifier: identifierSchema.optional(), email: identifierSchema.optional() };
export const hasIdentifier = (input: { identifier?: string; email?: string }) => Boolean(input.identifier || input.email);
export async function findAccount(store: Store, input: { identifier?: string; email?: string }) {
  const value = input.identifier ?? input.email ?? "";
  const email = value.includes("@");
  return (await store.list("User", { filters: [{ field: email ? "email" : "username", op: "eq", value: email ? value.toLowerCase() : normalize(value) }], limit: 1 }))[0];
}
export const legacyUsername = (id: string) => `legacy-${digest(id).slice(0, 24)}`;
export async function migrateAccountNames(store: Store) {
  for await (const user of store.iterate("User")) if (!user.username) {
    await store.transaction((tx) => tx.put("User", { ...user, username: legacyUsername(user.id) }));
  }
}
