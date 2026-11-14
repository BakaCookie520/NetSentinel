import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { entities, fieldsOf, modelOf, primaryOf, type Mutation, type Query, type RecordData } from "./model.js";

const database = new DatabaseSync((workerData as { path: string }).path);
database.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL");
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const version = Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
if (version > 1) throw new Error("STORAGE_SCHEMA_MISMATCH");
const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
if (tables.some((table) => ![...entities, "_storage_meta", "sqlite_sequence"].includes(String(table.name)))) throw new Error("STORAGE_SCHEMA_MISMATCH");
database.exec("BEGIN IMMEDIATE");
for (const entity of entities) {
  const fields = fieldsOf(entity);
  const columns = fields.map((field) => `${quote(field.name)} ${["Int", "Boolean"].includes(field.type) ? "INTEGER" : "TEXT"} ${field.isRequired ? "NOT NULL" : ""}`);
  const unique = [...fields.filter((field) => field.isUnique).map((field) => [field.name]), ...modelOf(entity).uniqueFields, primaryOf(entity)];
  const foreign = modelOf(entity).fields.filter((field) => field.kind === "object" && field.relationFromFields?.length).map((field) =>
    `FOREIGN KEY (${field.relationFromFields!.map(quote).join(",")}) REFERENCES ${quote(field.type)} (${field.relationToFields!.map(quote).join(",")}) ON DELETE ${field.relationOnDelete === "Cascade" ? "CASCADE" : field.relationOnDelete === "SetNull" ? "SET NULL" : "NO ACTION"} DEFERRABLE INITIALLY DEFERRED`);
  database.exec(`CREATE TABLE IF NOT EXISTS ${quote(entity)} (_key TEXT PRIMARY KEY, ${[...columns, ...unique.map((fields) => `UNIQUE (${fields.map(quote).join(",")})`), ...foreign].join(",")})`);
  for (const field of fields.filter((field) => !field.isList && field.type !== "Json")) {
    database.exec(`CREATE INDEX IF NOT EXISTS ${quote(`${entity}_${field.name}`)} ON ${quote(entity)} (${quote(field.name)})`);
  }
}
database.exec("CREATE TABLE IF NOT EXISTS _storage_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL); INSERT OR IGNORE INTO _storage_meta VALUES (1,0); PRAGMA user_version=1; COMMIT");
const encode = (entity: string, field: string, value: unknown): SQLInputValue => {
  const meta = fieldsOf(entity).find((item) => item.name === field)!;
  return value === null ? meta.type === "Json" && meta.isRequired ? "null" : null : meta.isList || meta.type === "Json" ? JSON.stringify(value) : meta.type === "Boolean" ? value ? 1 : 0 : value as SQLInputValue;
};
function decode(entity: string, row: RecordData): RecordData {
  return Object.fromEntries(fieldsOf(entity).map((field) => {
    const value = row[field.name];
    return [field.name, value === null ? null : field.isList || field.type === "Json" ? JSON.parse(String(value)) as unknown : field.type === "Boolean" ? Boolean(value) : value];
  }));
}
function revision() { return Number((database.prepare("SELECT revision FROM _storage_meta WHERE id=1").get() as { revision: number }).revision); }
parentPort!.on("message", (message: { id: number; op: string; entity: string; key: string; query: Query; expected: number; mutations: Mutation[] }) => {
  try {
    let result: unknown;
    if (message.op === "revision") result = revision();
    if (message.op === "get") {
      const row = database.prepare(`SELECT * FROM ${quote(modelOf(message.entity).name)} WHERE _key=?`).get(message.key);
      result = row ? decode(message.entity, row) : null;
    }
    if (message.op === "list") {
      const entity = modelOf(message.entity).name;
      const query = message.query;
      const params: SQLInputValue[] = [];
      const clauses: string[] = [];
      for (const filter of query.filters ?? []) {
        if (!fieldsOf(entity).some((field) => field.name === filter.field)) throw new Error("STORAGE_FIELD_INVALID");
        if (filter.op === "in") {
          const values = filter.value as unknown[];
          clauses.push(values.length ? `${quote(filter.field)} IN (${values.map(() => "?").join(",")})` : "0");
          params.push(...values.map((value) => encode(entity, filter.field, value)));
        } else if (filter.value === null) clauses.push(`${quote(filter.field)} IS ${filter.op === "ne" ? "NOT " : ""}NULL`);
        else {
          clauses.push(`${quote(filter.field)} ${{ eq: "=", ne: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=" }[filter.op]} ?`);
          params.push(encode(entity, filter.field, filter.value));
        }
      }
      if (query.after) { clauses.push("_key > ?"); params.push(query.after); }
      const order = query.order?.map((item) => {
        if (!fieldsOf(entity).some((field) => field.name === item.field)) throw new Error("STORAGE_FIELD_INVALID");
        return `${quote(item.field)} ${item.direction === "desc" ? "DESC" : "ASC"}`;
      }).join(",") || "_key ASC";
      params.push(Math.min(query.limit ?? 500, 10000));
      result = database.prepare(`SELECT * FROM ${quote(entity)} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`).all(...params).map((row) => decode(entity, row));
    }
    if (message.op === "commit") {
      database.exec("BEGIN IMMEDIATE");
      try {
        if (revision() !== message.expected) throw new Error("STORAGE_CONFLICT");
        for (const mutation of message.mutations) {
          const table = quote(modelOf(mutation.entity).name);
          if (mutation.row === null) database.prepare(`DELETE FROM ${table} WHERE _key=?`).run(mutation.key);
          else {
            const names = fieldsOf(mutation.entity).map((field) => field.name);
            database.prepare(`INSERT INTO ${table} (_key,${names.map(quote).join(",")}) VALUES (${["_key", ...names].map(() => "?").join(",")}) ON CONFLICT(_key) DO UPDATE SET ${names.map((name) => `${quote(name)}=excluded.${quote(name)}`).join(",")}`)
              .run(mutation.key, ...names.map((name) => encode(mutation.entity, name, mutation.row![name])));
          }
        }
        database.exec("UPDATE _storage_meta SET revision=revision+1 WHERE id=1; COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
      result = true;
    }
    if (message.op === "close") { database.close(); result = true; }
    parentPort!.postMessage({ id: message.id, result });
  } catch (error) { parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : "STORAGE_FAILED" }); }
});
