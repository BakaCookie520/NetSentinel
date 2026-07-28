import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { createClient, type RedisClientType } from "redis";
import { Subject } from "rxjs";
import { register, collectDefaultMetrics } from "prom-client";

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly probe = new Queue("probe", { connection: { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) } });
  readonly workflow = new Queue("workflow", { connection: { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) } });
  async onModuleDestroy(): Promise<void> { await Promise.all([this.probe.close(), this.workflow.close()]); }
}

@Injectable()
export class EventStreamService implements OnModuleInit, OnModuleDestroy {
  readonly events = new Subject<{ type: string; data: unknown }>();
  private client?: RedisClientType;

  async onModuleInit(): Promise<void> {
    this.client = createClient({ url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" });
    this.client.on("error", () => undefined);
    await this.client.connect();
    await this.client.subscribe("netsentinel:events", (message) => {
      try { this.events.next(JSON.parse(message) as { type: string; data: unknown }); } catch { /* Ignore malformed external events. */ }
    });
  }

  async onModuleDestroy(): Promise<void> { await this.client?.quit(); }
}

collectDefaultMetrics({ prefix: "netsentinel_" });
export const metrics = () => register.metrics();
