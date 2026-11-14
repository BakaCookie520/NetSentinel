import { Prisma, PrismaClient } from "@netsentinel/database";
import { fieldsOf, modelOf, primaryOf, rowKey, type Adapter, type EntityName, type RecordData, type Query, type Mutation } from "./model.js";

interface Delegate {
  findUnique(args: RecordData): Promise<RecordData | null>;
  findMany(args: RecordData): Promise<RecordData[]>;
  deleteMany(args: RecordData): Promise<unknown>;
  upsert(args: RecordData): Promise<unknown>;
}
const getDelegate = (client: unknown, entity: EntityName) => (client as Record<string, Delegate>)[entity[0]!.toLowerCase() + entity.slice(1)]!;
const serialized = (row: RecordData) => JSON.parse(JSON.stringify(row)) as RecordData;
function whereKey(entity: EntityName, key: string): RecordData {
  const fields = primaryOf(entity);
  const values = JSON.parse(key) as unknown[];
  const simple = Object.fromEntries(fields.map((field, index) => [field, fieldsOf(entity).find((item) => item.name === field)?.type === "DateTime" ? new Date(String(values[index])) : values[index]]));
  return fields.length === 1 ? simple : { [modelOf(entity).primaryKey?.name ?? fields.join("_")]: simple };
}
export class PostgresAdapter implements Adapter {
  readonly kind = "postgresql" as const;
  readonly client: PrismaClient;
  constructor(url: string) { this.client = new PrismaClient({ datasourceUrl: url }); }
  async revision() {
    const row = await this.client.setting.findUnique({ where: { key: "__storageRevision" } });
    return Number(row?.value ?? 0);
  }
  async get(entity: EntityName, key: string) {
    const row = await getDelegate(this.client, entity).findUnique({ where: whereKey(entity, key) });
    return row ? serialized(row) : null;
  }
  async list(entity: EntityName, query: Query = {}) {
    const filters = query.filters?.map((filter) => {
      const field = fieldsOf(entity).find((item) => item.name === filter.field);
      if (!field) throw new Error("STORAGE_FIELD_INVALID");
      const convert = (value: unknown) => field.type === "DateTime" && typeof value === "string" ? new Date(value) : value;
      const value = filter.op === "in" ? (filter.value as unknown[]).map(convert) : convert(filter.value);
      return { [filter.field]: filter.op === "eq" ? value : { [filter.op === "ne" ? "not" : filter.op]: value } };
    }) ?? [];
    const rows = await getDelegate(this.client, entity).findMany({
      where: { AND: filters }, take: Math.min(query.limit ?? 500, 10000),
      orderBy: query.order?.map((item) => ({ [item.field]: item.direction })) ?? primaryOf(entity).map((field) => ({ [field]: "asc" })),
      ...(query.after ? { cursor: whereKey(entity, query.after), skip: 1 } : {}),
    });
    return rows.map(serialized);
  }
  async commit(expected: number, mutations: Mutation[]) {
    await this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1567843202)`;
      const revision = await tx.setting.findUnique({ where: { key: "__storageRevision" } });
      if (Number(revision?.value ?? 0) !== expected) throw new Error("STORAGE_CONFLICT");
      for (const mutation of mutations) {
        const delegate = getDelegate(tx, mutation.entity);
        const where = whereKey(mutation.entity, mutation.key);
        if (!mutation.row) {
          const primary = JSON.parse(mutation.key) as unknown[];
          await delegate.deleteMany({ where: Object.fromEntries(primaryOf(mutation.entity).map((field, index) => [field, primary[index]])) });
        } else {
          const data: RecordData = { ...mutation.row };
          for (const field of fieldsOf(mutation.entity)) {
            if (field.type === "DateTime" && typeof data[field.name] === "string") data[field.name] = new Date(String(data[field.name]));
            if (field.type === "Json" && data[field.name] === null) data[field.name] = field.isRequired ? Prisma.JsonNull : Prisma.DbNull;
          }
          await delegate.upsert({ where, create: data, update: data });
        }
      }
      await tx.setting.upsert({ where: { key: "__storageRevision" }, create: { key: "__storageRevision", value: expected + 1 }, update: { value: expected + 1 } });
    }, { timeout: 120_000 });
  }
  async close() { await this.client.$disconnect(); }
}
