import { randomUUID } from "node:crypto";
import { Prisma } from "@netsentinel/database";

type Serialized<T> = T extends Date ? string : T extends Array<infer Item> ? Serialized<Item>[] : T extends object ? { [Key in keyof T]: Serialized<T[Key]> } : T;
export type EntityName = keyof Prisma.TypeMap["model"];
export type EntityRow<Name extends EntityName> = Serialized<Prisma.TypeMap["model"][Name]["payload"]["scalars"]>;
export type RecordData = Record<string, unknown>;
export const models = Prisma.dmmf.datamodel.models;
export const entities = models.map((model) => model.name as EntityName);
export const privateSetting = (key: unknown) => typeof key === "string" && (key.startsWith("__") || key === "_backupRestoreCheckpoint");
export const modelOf = (name: string) => {
  const model = models.find((item) => item.name === name);
  if (!model) throw new Error("STORAGE_ENTITY_INVALID");
  return model;
};
export const fieldsOf = (name: string) => modelOf(name).fields.filter((field) => field.kind !== "object");
export const primaryOf = (name: string): readonly string[] => modelOf(name).primaryKey?.fields ?? modelOf(name).fields.filter((field) => field.isId).map((field) => field.name);
export function rowKey(name: string, row: RecordData): string {
  return JSON.stringify(primaryOf(name).map((field) => row[field]));
}
export function normalizeRow(name: EntityName, input: RecordData): RecordData {
  const row: RecordData = {};
  for (const field of fieldsOf(name)) {
    let value = input[field.name];
    if (value instanceof Date) value = value.toISOString();
    if (value === undefined) {
      if (field.isId && field.type === "String") value = randomUUID();
      else if (field.isList) value = [];
      else if (field.isUpdatedAt) value = new Date().toISOString();
      else if (field.hasDefaultValue) value = typeof field.default === "object" && field.default !== null
        ? ((field.default as { name: string }).name === "now" ? new Date().toISOString() : randomUUID()) : field.default;
      else if (!field.isRequired) value = null;
      else throw new Error(`STORAGE_REQUIRED:${name}.${field.name}`);
    }
    if (value === null) {
      if (field.isRequired && field.type !== "Json") throw new Error("STORAGE_NULL_INVALID");
    } else if (field.isList) {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("STORAGE_LIST_INVALID");
    } else if (field.kind === "enum") {
      if (!Prisma.dmmf.datamodel.enums.find((item) => item.name === field.type)?.values.some((item) => item.name === value)) throw new Error("STORAGE_ENUM_INVALID");
    } else if (field.type === "String" && typeof value !== "string") throw new Error("STORAGE_STRING_INVALID");
    else if (field.type === "Int" && (typeof value !== "number" || !Number.isInteger(value) || value < -2147483648 || value > 2147483647)) throw new Error("STORAGE_INTEGER_INVALID");
    else if (field.type === "Boolean" && typeof value !== "boolean") throw new Error("STORAGE_BOOLEAN_INVALID");
    else if (field.type === "DateTime" && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) throw new Error("STORAGE_DATE_INVALID");
    row[field.name] = value;
  }
  if (Object.keys(input).some((key) => !fieldsOf(name).some((field) => field.name === key))) throw new Error("STORAGE_FIELD_INVALID");
  return row;
}
export interface Filter { field: string; op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in"; value: unknown }
export interface Query {
  filters?: Filter[];
  order?: { field: string; direction: "asc" | "desc" }[];
  after?: string;
  limit?: number;
}
export interface Mutation { entity: EntityName; key: string; row: RecordData | null }
export interface Adapter {
  readonly kind: "sqlite" | "postgresql" | "redis";
  revision(): Promise<number>;
  get(entity: EntityName, key: string): Promise<RecordData | null>;
  list(entity: EntityName, query?: Query): Promise<RecordData[]>;
  commit(expected: number, mutations: Mutation[]): Promise<void>;
  close(): Promise<void>;
}
export function matches(row: RecordData, filters: Filter[] = []): boolean {
  return filters.every(({ field, op, value }) => {
    const actual = row[field] as string | number | boolean | null;
    switch (op) {
      case "eq": return actual === value;
      case "ne": return actual !== value;
      case "in": return Array.isArray(value) && value.includes(actual);
      case "lt": return actual !== null && actual < (value as string);
      case "lte": return actual !== null && actual <= (value as string);
      case "gt": return actual !== null && actual > (value as string);
      case "gte": return actual !== null && actual >= (value as string);
    }
  });
}
export function sortRows(rows: RecordData[], order: Query["order"] = []): RecordData[] {
  return rows.sort((left, right) => {
    for (const { field, direction } of order) {
      const first = left[field] as string | number; const second = right[field] as string | number;
      const comparison = first === second ? 0 : first == null ? -1 : second == null ? 1 : first < second ? -1 : 1;
      if (comparison) return direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}
