import { request, type FullConfig } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const authStatePath = resolve("test-results/.auth/user.json");
export const authMetadataPath = resolve("test-results/.auth/metadata.json");

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:5173";
  const password = process.env.E2E_REAL_PASSWORD ?? "IntegrationPass123!";
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/v1/auth/login", {
    data: { email: "admin@netsentinel.local", password },
  });
  if (!response.ok()) {
    throw new Error(
      `E2E authentication failed: ${response.status()} ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as {
    csrfToken: string;
    user: {
      id: string;
      email: string;
      displayName: string;
      permissions: string[];
    };
  };
  await mkdir(dirname(authStatePath), { recursive: true });
  await context.storageState({ path: authStatePath });
  await writeFile(
    authMetadataPath,
    JSON.stringify({ csrfToken: payload.csrfToken, user: payload.user }),
    "utf8",
  );
  await context.dispose();
}
