import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveWebConsole } from "./web-console.js";

describe("serveWebConsole", () => {
  let directory: string;
  let closeServer: () => Promise<void>;
  let origin: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "netsentinel-web-"));
    await writeFile(join(directory, "index.html"), "<!doctype html><title>NetSentinel</title>");
    await writeFile(join(directory, "asset.js"), "console.log('asset');");

    const app = express();
    serveWebConsole(app, directory);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    origin = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  afterEach(async () => {
    await closeServer();
    await rm(directory, { recursive: true, force: true });
  });

  it("serves bundled assets and falls back to the SPA for browser routes", async () => {
    const [asset, route] = await Promise.all([fetch(`${origin}/asset.js`), fetch(`${origin}/monitors/active`)]);

    await expect(asset.text()).resolves.toBe("console.log('asset');");
    await expect(route.text()).resolves.toContain("<title>NetSentinel</title>");
  });

  it("does not intercept API or agent endpoints", async () => {
    const [api, agent] = await Promise.all([fetch(`${origin}/api/v1/health/ready`), fetch(`${origin}/agent/v1/connect`)]);

    expect(api.status).toBe(404);
    expect(agent.status).toBe(404);
  });
});
