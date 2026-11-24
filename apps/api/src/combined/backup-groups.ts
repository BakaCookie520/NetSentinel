import { BACKUP_GROUPS, type BackupGroup } from "@netsentinel/contracts";
import { z } from "zod";
import { TABLES } from "../backup-database.js";
import { models, primaryOf, rowKey, type EntityName, type RecordData } from "../storage/model.js";
import type { Store } from "../storage/store.js";

export const backupEntities: EntityName[] = [...TABLES, "AccountSecurity"];
const accounts: EntityName[] = ["User", "Role", "UserRole", "ApiToken", "AccountSecurity"];
export const groupFor = (entity: EntityName): BackupGroup => accounts.includes(entity) ? "accounts" : entity === "Setting" ? "settings" : entity === "AuditEvent" ? "audit" : "operations";
export const allGroups = () => [...BACKUP_GROUPS];
export const groupsSchema = z.array(z.enum(BACKUP_GROUPS)).min(1).max(BACKUP_GROUPS.length).refine((groups) => new Set(groups).size === groups.length);
export function normalizeGroups(groups?: BackupGroup[]) {
  if (!groups) return allGroups();
  const selected = groupsSchema.parse(groups);
  return BACKUP_GROUPS.filter((group) => selected.includes(group));
}

const relations = [
  ...models.filter((model) => backupEntities.includes(model.name as EntityName)).flatMap((model) => model.fields
    .filter((field) => field.kind === "object" && field.relationFromFields?.length)
    .map((field) => ({ source: model.name as EntityName, target: field.type as EntityName, from: field.relationFromFields!, to: field.relationToFields! }))),
  { source: "AccountSecurity", target: "User", from: ["userId"], to: ["id"] } as const,
];

// Archives can omit a referenced group. Validate all internal references on import,
// then validate both directions against the projected live site before replacement.
export async function verifyRelations(staged: Store, groups: readonly BackupGroup[], live?: Store) {
  for (const relation of relations) {
    const sourceSelected = groups.includes(groupFor(relation.source));
    const targetSelected = groups.includes(groupFor(relation.target));
    if ((!sourceSelected && !targetSelected) || (!live && !(sourceSelected && targetSelected))) continue;
    const source = sourceSelected ? staged : live!;
    const target = targetSelected ? staged : live!;
    const primary = primaryOf(relation.target);
    for await (const input of source.iterate(relation.source)) {
      const row = input as RecordData;
      const values = Object.fromEntries(relation.to.map((key, index) => [key, row[relation.from[index]!]!]));
      if (Object.values(values).some((value) => value == null)) continue;
      const exists = primary.length === relation.to.length && primary.every((key) => Object.hasOwn(values, key))
        ? await target.adapter.get(relation.target, rowKey(relation.target, values))
        : (await target.list(relation.target, { filters: Object.entries(values).map(([field, value]) => ({ field, op: "eq", value })), limit: 1 }))[0];
      if (!exists) throw new Error(live ? "BACKUP_DEPENDENCY_CONFLICT" : "BACKUP_RELATION_INVALID");
    }
  }
}
export async function verifyAdmin(store: Store) {
  const roles = new Set((await store.all("Role")).filter((role) => role.permissions.includes("user:manage")).map(({ id }) => id));
  for await (const link of store.iterate("UserRole")) {
    if (!roles.has(link.roleId)) continue;
    const user = await store.get("User", link.userId);
    if (user && !user.disabledAt && (user.username || user.email) && user.passwordHash) return;
  }
  throw new Error("BACKUP_ADMIN_MISSING");
}
