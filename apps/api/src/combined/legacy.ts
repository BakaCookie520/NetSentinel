import { Redis } from "ioredis";
import type { Store } from "../storage/store.js";

export async function requireLegacyDrain(store: Store): Promise<void> {
  if (store.adapter.kind !== "postgresql" || (await store.get("Setting", "__initialized"))?.value === true) return;
  if (!(await store.list("User", { limit: 1 })).length) return;
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) throw new Error("LEGACY_QUEUE_CHECK_REQUIRED");
  const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000 }) :
    new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT ?? 6379), lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000 });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    const clients = await redis.client("LIST");
    if (typeof clients === "string" && /name=bull:(?:probe|workflow|cHJvYmU|d29ya2Zsb3c)/u.test(clients)) throw new Error("LEGACY_WORKER_MUST_STOP");
    for (const queue of ["probe", "workflow"]) {
      if (await redis.llen(`bull:${queue}:active`) || await redis.llen(`bull:${queue}:wait`) || await redis.zcard(`bull:${queue}:delayed`)) throw new Error("LEGACY_QUEUE_MUST_DRAIN");
    }
  } finally { redis.disconnect(); }
}
