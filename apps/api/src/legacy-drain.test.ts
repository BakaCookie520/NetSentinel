import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({ connect: vi.fn(), client: vi.fn(), llen: vi.fn(), zcard: vi.fn(), disconnect: vi.fn(), on: vi.fn() }));
vi.mock("ioredis", () => ({ Redis: class { constructor() { return redis; } } }));
import { requireLegacyDrain } from "./combined/legacy.js";

beforeEach(() => {
  vi.resetAllMocks();
  redis.connect.mockResolvedValue(undefined); redis.client.mockResolvedValue(""); redis.llen.mockResolvedValue(0); redis.zcard.mockResolvedValue(0);
  vi.stubEnv("REDIS_URL", "redis://legacy-queue.example:6379"); vi.stubEnv("REDIS_HOST", "");
});
afterEach(() => vi.unstubAllEnvs());
const store = () => ({ adapter: { kind: "postgresql" }, get: vi.fn().mockResolvedValue(null), list: vi.fn().mockResolvedValue([{ id: "legacy-user" }]) });
describe("legacy worker migration fence", () => {
  it("requires explicit access to the old queue instead of silently enabling a second executor", async () => {
    vi.stubEnv("REDIS_URL", "");
    await expect(requireLegacyDrain(store() as never)).rejects.toThrow("LEGACY_QUEUE_CHECK_REQUIRED");
  });
  it("rejects a connected legacy worker and pending tasks without deleting them", async () => {
    redis.client.mockResolvedValue("id=1 name=bull:cHJvYmU= addr=127.0.0.1");
    await expect(requireLegacyDrain(store() as never)).rejects.toThrow("LEGACY_WORKER_MUST_STOP");
    expect(redis.disconnect).toHaveBeenCalled();
    redis.client.mockResolvedValue(""); redis.llen.mockResolvedValue(1);
    await expect(requireLegacyDrain(store() as never)).rejects.toThrow("LEGACY_QUEUE_MUST_DRAIN");
  });
  it("permits a drained legacy site and does not require Redis for an already-adopted site", async () => {
    await expect(requireLegacyDrain(store() as never)).resolves.toBeUndefined();
    const current = store(); current.get.mockResolvedValue({ value: true });
    redis.connect.mockClear(); await requireLegacyDrain(current as never);
    expect(redis.connect).not.toHaveBeenCalled();
  });
});
