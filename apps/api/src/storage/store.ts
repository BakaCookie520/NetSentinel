import { type Adapter, type EntityName, type EntityRow, type RecordData, type Mutation, type Query, fieldsOf, models, primaryOf, normalizeRow, rowKey, sortRows, matches } from "./model.js";

export class Store {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly adapter: Adapter) {}
  async get<Name extends EntityName>(entity: Name, key: string | RecordData): Promise<EntityRow<Name> | null> {
    const primary = typeof key === "string" ? JSON.stringify([key]) : rowKey(entity, key);
    return await this.adapter.get(entity, primary) as EntityRow<Name> | null;
  }
  async list<Name extends EntityName>(entity: Name, query: Query = {}): Promise<EntityRow<Name>[]> {
    return await this.adapter.list(entity, query) as EntityRow<Name>[];
  }
  async all<Name extends EntityName>(entity: Name, filters: Query["filters"] = []): Promise<EntityRow<Name>[]> {
    const rows: EntityRow<Name>[] = [];
    for await (const row of this.iterate(entity, { filters })) rows.push(row);
    return rows;
  }
  async *iterate<Name extends EntityName>(entity: Name, query: Query = {}): AsyncGenerator<EntityRow<Name>> {
    let after: string | undefined;
    do {
      const rows = await this.list(entity, { ...query, after, limit: 500 });
      if (!rows.length) return;
      for (const row of rows) yield row;
      after = rowKey(entity, rows.at(-1)! as RecordData);
      if (rows.length < 500) return;
    } while (true);
  }
  transaction<T>(action: (tx: UnitOfWork) => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const tx = new UnitOfWork(this, await this.adapter.revision());
        const result = await action(tx);
        try { await tx.commit(); return result; }
        catch (error) { if (!(error instanceof Error) || error.message !== "STORAGE_CONFLICT" || attempt === 3) throw error; }
      }
      throw new Error("STORAGE_CONFLICT");
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}
export class UnitOfWork {
  private pending = new Map<string, Mutation>();
  constructor(private store: Store, private revision: number) {}
  async get<Name extends EntityName>(entity: Name, key: string | RecordData): Promise<EntityRow<Name> | null> {
    const primary = typeof key === "string" ? JSON.stringify([key]) : rowKey(entity, key);
    const pending = this.pending.get(`${entity}:${primary}`);
    if (pending) return pending.row as EntityRow<Name> | null;
    return this.store.get(entity, key);
  }
  async list<Name extends EntityName>(entity: Name, query: Query = {}): Promise<EntityRow<Name>[]> {
    const rows = new Map<string, RecordData>();
    const data = await this.store.all(entity, query.filters);
    for (const row of data) rows.set(rowKey(entity, row as RecordData), row as RecordData);
    for (const mutation of this.pending.values()) if (mutation.entity === entity) {
      if (!mutation.row || !matches(mutation.row, query.filters)) rows.delete(mutation.key);
      else rows.set(mutation.key, mutation.row);
    }
    const values = [...rows.values()].filter((row) => !query.after || rowKey(entity, row) > query.after);
    return sortRows(values, query.order).slice(0, query.limit ?? Number.MAX_SAFE_INTEGER) as EntityRow<Name>[];
  }
  async put<Name extends EntityName>(entity: Name, input: Partial<EntityRow<Name>>, expectedVersion?: number): Promise<EntityRow<Name>> {
    const row = normalizeRow(entity, input as RecordData);
    const key = rowKey(entity, row);
    if (expectedVersion !== undefined) {
      const previous = await this.get(entity, Object.fromEntries(primaryOf(entity).map((field) => [field, row[field]])));
      if (!previous || (previous as RecordData).version !== expectedVersion) throw new Error("STORAGE_CONFLICT");
      row.version = expectedVersion + 1;
      if (fieldsOf(entity).some((field) => field.isUpdatedAt)) row.updatedAt = new Date().toISOString();
    }
    this.pending.set(`${entity}:${key}`, { entity, key, row });
    return row as EntityRow<Name>;
  }
  async remove(entity: EntityName, key: string | RecordData): Promise<void> {
    const previous = await this.get(entity, key);
    if (!previous) return;
    const primary = rowKey(entity, previous as RecordData);
    if (entity === "User") {
      const security = await this.get("AccountSecurity", String((previous as RecordData).id));
      if (security) await this.remove("AccountSecurity", security.userId);
    }
    for (const model of models) {
      for (const relation of model.fields.filter((field) => field.kind === "object" && field.type === entity && field.relationFromFields?.length)) {
        const references = await this.list(model.name as EntityName, { filters: relation.relationFromFields!.map((field, index) => ({
          field, op: "eq", value: (previous as RecordData)[relation.relationToFields![index]!],
        })) });
        for (const reference of references) {
          const referencingKey = Object.fromEntries(primaryOf(model.name).map((field) => [field, (reference as RecordData)[field]]));
          if (relation.relationOnDelete === "Cascade") await this.remove(model.name as EntityName, referencingKey);
          else if (relation.relationOnDelete === "SetNull") await this.put(model.name as EntityName, { ...reference, ...Object.fromEntries(relation.relationFromFields!.map((field) => [field, null])) });
          else if (!this.pending.has(`${model.name}:${rowKey(model.name, reference as RecordData)}`)) throw new Error("STORAGE_IN_USE");
        }
      }
    }
    this.pending.set(`${entity}:${primary}`, { entity, key: primary, row: null });
  }
  async commit(): Promise<void> {
    for (const mutation of this.pending.values()) {
      if (!mutation.row) continue;
      const { entity, row } = mutation;
      if (entity === "AccountSecurity" && !await this.get("User", String(row.userId))) throw new Error("STORAGE_RELATION_INVALID");
      const model = models.find((item) => item.name === entity)!;
      const uniqueFields = [...fieldsOf(entity).filter((field) => field.isUnique).map((field) => [field.name]), ...model.uniqueFields];
      for (const fields of uniqueFields) {
        if (fields.some((field) => row[field] === null)) continue;
        const matches = await this.list(entity, { filters: fields.map((field) => ({ field, op: "eq", value: row[field] })) });
        if (matches.some((item) => rowKey(entity, item as RecordData) !== mutation.key)) throw new Error("STORAGE_DUPLICATE");
      }
      for (const relation of model.fields.filter((field) => field.kind === "object" && field.relationFromFields?.length)) {
        const values = relation.relationFromFields!.map((field) => row[field]);
        if (values.some((value) => value === null)) continue;
        const matches = await this.list(relation.type as EntityName, { filters: relation.relationToFields!.map((field, index) => ({ field, op: "eq", value: values[index] })) });
        if (!matches.length) throw new Error("STORAGE_RELATION_INVALID");
      }
    }
    if (this.pending.size) await this.store.adapter.commit(this.revision, [...this.pending.values()]);
  }
}
