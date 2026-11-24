import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { type Adapter, type EntityName, type Mutation, type Query, type RecordData, fieldsOf, matches, sortRows } from "./model.js";

const applyScript = `
local changes=cjson.decode(ARGV[1])
for _,change in ipairs(changes) do
  local result=redis.pcall(unpack(change))
  if type(result)=='table' and result.err then return redis.error_reply('STORAGE_WRITE_FAILED') end
end
return 1`;
export class RedisAdapter implements Adapter {
  readonly kind = "redis" as const;
  readonly client: Redis;
  private constructor(url: string, readonly prefix: string) {
    this.client = new Redis(url, { maxRetriesPerRequest: 1, enableReadyCheck: true, lazyConnect: true });
  }
  static async open(url: string, prefix: string): Promise<RedisAdapter> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(prefix)) throw new Error("REDIS_NAMESPACE_INVALID");
    const adapter = new RedisAdapter(url, `${prefix}:`);
    try {
      await adapter.client.connect();
      const persistence = await adapter.client.config("GET", "appendonly") as string[];
      const eviction = await adapter.client.config("GET", "maxmemory-policy") as string[];
      if (persistence[1] !== "yes" || eviction[1] !== "noeviction") throw new Error("REDIS_REQUIRES_AOF_NOEVICTION");
      let scanCursor = "0";
      do {
        const [cursor, keys] = await adapter.client.scan(scanCursor, "MATCH", `${adapter.prefix}*`, "COUNT", 500);
        if (keys.some((key) => !/^(?:row:|keys:|eq:|revision$|journal$|time:|query:)/u.test(key.slice(adapter.prefix.length)))) throw new Error("SETUP_DATABASE_NOT_EMPTY");
        scanCursor = cursor;
      } while (scanCursor !== "0");
      const pending = await adapter.client.get(`${adapter.prefix}journal`);
      if (pending) {
        const leaseText = await adapter.client.get(adapter.record("Setting", JSON.stringify(["__runtimeOwner"])));
        const lease = leaseText ? (JSON.parse(leaseText) as { value: { expires: number } }).value : null;
        if (lease && lease.expires > Date.now()) throw new Error("STORAGE_RECOVERY_OWNER_ACTIVE");
        const recovery = JSON.parse(pending) as { expected: number; before: Mutation[] };
        const revision = Number(await adapter.client.get(`${adapter.prefix}revision`) ?? 0);
        if (revision === recovery.expected) await adapter.apply(recovery.before);
        await adapter.client.del(`${adapter.prefix}journal`);
      }
      return adapter;
    } catch (error) { adapter.client.disconnect(); throw error; }
  }
  private async healthy() { if (await this.client.exists(`${this.prefix}journal`)) throw new Error("STORAGE_RECOVERY_REQUIRED"); }
  async revision() { await this.healthy(); return Number(await this.client.get(`${this.prefix}revision`) ?? 0); }
  private record(entity: string, key: string) { return `${this.prefix}row:${entity}:${key}`; }
  async get(entity: EntityName, key: string) {
    await this.healthy();
    const row = await this.client.get(this.record(entity, key));
    await this.healthy();
    return row ? JSON.parse(row) as RecordData : null;
  }
  async list(entity: EntityName, query: Query = {}) {
    await this.healthy();
    const allowedFields = new Set(fieldsOf(entity).map((field) => field.name));
    if ((query.filters ?? []).some((filter) => !allowedFields.has(filter.field)) || (query.order ?? []).some((order) => !allowedFields.has(order.field))) throw new Error("STORAGE_FIELD_INVALID");
    const rows: RecordData[] = [];
    const equality = query.filters?.find((filter) => filter.op === "eq" && filter.value !== null && typeof filter.value !== "object");
    let index = equality ? `${this.prefix}eq:${entity}:${equality.field}:${JSON.stringify(equality.value)}` : `${this.prefix}keys:${entity}`;
    const temporal = query.filters?.find((filter) => ["lt", "lte", "gt", "gte"].includes(filter.op) && fieldsOf(entity).some((field) => field.name === filter.field && field.type === "DateTime"));
    const temporary: string[] = [];
    if (temporal) {
      const range = `${this.prefix}query:${randomUUID()}`; const combined = `${this.prefix}query:${randomUUID()}`;
      temporary.push(range, combined);
      const bounds = query.filters!.filter((filter) => filter.field === temporal.field && ["lt", "lte", "gt", "gte"].includes(filter.op));
      let minimum = "-inf"; let maximum = "+inf";
      for (const bound of bounds) {
        const score = Date.parse(String(bound.value));
        if (!Number.isFinite(score)) throw new Error("STORAGE_DATE_INVALID");
        if (bound.op === "gt" || bound.op === "gte") minimum = `${bound.op === "gt" ? "(" : ""}${score}`;
        else maximum = `${bound.op === "lt" ? "(" : ""}${score}`;
      }
      await this.client.eval(`
        redis.call('ZRANGESTORE',KEYS[1],KEYS[3],ARGV[1],ARGV[2],'BYSCORE')
        redis.call('EXPIRE',KEYS[1],60)
        redis.call('ZINTERSTORE',KEYS[2],2,KEYS[1],KEYS[4],'WEIGHTS',0,0)
        redis.call('EXPIRE',KEYS[2],60)
        return 1`, 4, range, combined, `${this.prefix}time:${entity}:${temporal.field}`, index, minimum, maximum);
      index = combined;
    }
    let after = query.after;
    try { do {
      const keys = await this.client.zrangebylex(index, after ? `(${after}` : "-", "+", "LIMIT", 0, 500);
      if (!keys.length) break;
      const values = await this.client.mget(...keys.map((key) => this.record(entity, key)));
      for (const value of values) if (value) {
        const row = JSON.parse(value) as RecordData;
        if (matches(row, query.filters)) rows.push(row);
      }
      after = keys.at(-1);
      if (!query.order && rows.length >= (query.limit ?? 500)) break;
      if (keys.length < 500) break;
    } while (true);
    await this.healthy();
    return sortRows(rows, query.order).slice(0, query.limit ?? 500);
    } finally { if (temporary.length) await this.client.del(...temporary); }
  }
  private async commands(mutations: Mutation[]): Promise<Array<Array<string | number>>> {
    const commands: Array<Array<string | number>> = [];
    for (const mutation of mutations) {
      const key = this.record(mutation.entity, mutation.key);
      const previousText = await this.client.get(key);
      const previous = previousText ? JSON.parse(previousText) as RecordData : null;
      for (const field of fieldsOf(mutation.entity).filter((field) => !field.isList && field.type !== "Json")) {
        if (previous) commands.push(["ZREM", `${this.prefix}eq:${mutation.entity}:${field.name}:${JSON.stringify(previous[field.name])}`, mutation.key]);
        if (mutation.row) commands.push(["ZADD", `${this.prefix}eq:${mutation.entity}:${field.name}:${JSON.stringify(mutation.row[field.name])}`, 0, mutation.key]);
        if (field.type === "DateTime") {
          commands.push(["ZREM", `${this.prefix}time:${mutation.entity}:${field.name}`, mutation.key]);
          if (mutation.row?.[field.name] !== null && mutation.row?.[field.name] !== undefined) commands.push(["ZADD", `${this.prefix}time:${mutation.entity}:${field.name}`, Date.parse(String(mutation.row[field.name])), mutation.key]);
        }
      }
      commands.push(mutation.row ? ["SET", key, JSON.stringify(mutation.row)] : ["DEL", key]);
      commands.push(mutation.row ? ["ZADD", `${this.prefix}keys:${mutation.entity}`, 0, mutation.key] : ["ZREM", `${this.prefix}keys:${mutation.entity}`, mutation.key]);
    }
    return commands;
  }
  private async apply(mutations: Mutation[]) { await this.client.eval(applyScript, 0, JSON.stringify(await this.commands(mutations))); }
  async commit(expected: number, mutations: Mutation[]) {
    // Redis has no relational constraints; only apply the final value per key.
    mutations = [...new Map(mutations.map((mutation) => [`${mutation.entity}:${mutation.key}`, mutation])).values()];
    const connection = this.client.duplicate();
    try {
      await connection.watch(`${this.prefix}revision`, `${this.prefix}journal`);
      const current = Number(await connection.get(`${this.prefix}revision`) ?? 0);
      if (current !== expected || await connection.exists(`${this.prefix}journal`)) throw new Error("STORAGE_CONFLICT");
      const before = await Promise.all(mutations.map(async (mutation) => ({ ...mutation, row: await this.get(mutation.entity, mutation.key) })));
      const commands = await this.commands(mutations);
      const prepared = await connection.multi().set(`${this.prefix}journal`, JSON.stringify({ expected, before })).exec();
      if (!prepared) throw new Error("STORAGE_CONFLICT");
      const committed = [...commands, ["SET", `${this.prefix}revision`, expected + 1], ["DEL", `${this.prefix}journal`]];
      await this.client.eval(applyScript, 0, JSON.stringify(committed));
    } finally { await connection.quit(); }
  }
  async close() { await this.client.quit(); }
}
