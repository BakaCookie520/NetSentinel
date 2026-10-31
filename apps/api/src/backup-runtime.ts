import { ConflictException, Injectable, ServiceUnavailableException, type CallHandler, type ExecutionContext, type NestInterceptor, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { defer, finalize, mergeMap } from "rxjs";
import { BACKUP_LOCK, RESTORE_GATE } from "./backup-types.js";

const WRITERS = "netsentinel:restore:writers";
const AVATAR_WRITERS = "netsentinel:backup:avatar-writers";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class BackupRuntime implements OnModuleDestroy, NestInterceptor {
  readonly redis = new Redis({ host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379), maxRetriesPerRequest: 2 });
  private active = new Map<string, boolean>();
  private heartbeat = setInterval(() => {
    for (const [id, avatar] of this.active) {
      void this.redis.zadd(WRITERS, Date.now() + 120_000, id).catch(() => undefined);
      if (avatar) void this.redis.zadd(AVATAR_WRITERS, Date.now() + 120_000, id).catch(() => undefined);
    }
  }, 10_000);

  async enterWrite(avatar = false): Promise<() => Promise<void>> {
    const id = randomUUID();
    const ok = await this.redis.eval(`
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      if ARGV[3] == '1' and redis.call('EXISTS', KEYS[3]) == 1 then return 2 end
      redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
      if ARGV[3] == '1' then redis.call('ZADD', KEYS[4], ARGV[2], ARGV[1]) end
      return 1`, 4, RESTORE_GATE, WRITERS, BACKUP_LOCK, AVATAR_WRITERS, id, Date.now() + 120_000, avatar ? "1" : "0");
    if (ok === 0) throw new ServiceUnavailableException("RESTORE_IN_PROGRESS");
    if (ok !== 1) throw new ConflictException("BACKUP_AVATAR_BUSY");
    this.active.set(id, avatar);
    return async () => {
      this.active.delete(id);
      await Promise.all([this.redis.zrem(WRITERS, id), this.redis.zrem(AVATAR_WRITERS, id)]);
    };
  }
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<{ method: string; originalUrl: string }>();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || /^\/api\/v1\/admin\/backups(?:\/|$)/u.test(req.originalUrl)) return next.handle();
    return defer(() => this.enterWrite(req.originalUrl.startsWith("/api/v1/auth/me/avatar"))).pipe(
      mergeMap((release) => next.handle().pipe(finalize(() => { void release().catch(() => undefined); }))),
    );
  }
  async waitWriters(avatarsOnly = false, timeout = 60_000): Promise<void> {
    const deadline = Date.now() + timeout;
    const key = avatarsOnly ? AVATAR_WRITERS : WRITERS;
    while (Date.now() < deadline) {
      await this.redis.zremrangebyscore(key, "-inf", Date.now());
      if (!(await this.redis.zcard(key))) return;
      await delay(100);
    }
    throw new Error("BACKUP_WRITERS_TIMEOUT");
  }
  async onModuleDestroy(): Promise<void> { clearInterval(this.heartbeat); await this.redis.quit(); }
}
