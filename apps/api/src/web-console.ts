import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";

export function webAssetsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
}

export function serveWebConsole(app: Express, webAssets = webAssetsDirectory()): void {
  if (!existsSync(webAssets)) return;

  app.use(express.static(webAssets, { index: false }));
  app.get(/^(?!\/(?:api|agent)(?:\/|$)).*/, (_request, response) => response.sendFile("index.html", { root: webAssets }));
}
