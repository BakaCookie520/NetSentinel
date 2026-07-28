import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const playwrightConfig = readFileSync(
  new URL("../apps/web/playwright.config.ts", import.meta.url),
  "utf8",
);
const typedConfigTests = readFileSync(
  new URL("../apps/web/tests/typed-config.spec.ts", import.meta.url),
  "utf8",
);
const e2eCommand = "pnpm --filter @netsentinel/web test:e2e";
const e2eIndex = workflow.indexOf(e2eCommand);

assert.notEqual(e2eIndex, -1, `CI workflow must run ${e2eCommand}`);

for (const requiredService of ["postgres:", "redis:"]) {
  const serviceIndex = workflow.indexOf(requiredService);
  assert(
    serviceIndex !== -1 && serviceIndex < e2eIndex,
    `CI must provision ${requiredService.slice(0, -1)} before Playwright`,
  );
}

for (const requiredEnvironment of [
  "DATABASE_URL:",
  "REDIS_URL:",
  "NETSENTINEL_MASTER_KEY:",
  "INITIAL_ADMIN_EMAIL:",
  "INITIAL_ADMIN_PASSWORD:",
]) {
  assert(
    workflow.includes(requiredEnvironment),
    `CI must define ${requiredEnvironment.slice(0, -1)} for E2E`,
  );
}

for (const prerequisite of [
  "prisma:migrate",
  "apps/api/dist/bootstrap-admin.js",
  "apps/api/dist/main.js",
  "/api/v1/health/ready",
]) {
  const prerequisiteIndex = workflow.indexOf(prerequisite);
  assert(
    prerequisiteIndex !== -1 && prerequisiteIndex < e2eIndex,
    `CI must run ${prerequisite} before Playwright`,
  );
}

assert(
  playwrightConfig.includes("workers: process.env.CI ? 1 : undefined"),
  "Playwright must use one worker in constrained CI runners",
);
assert(
  !typedConfigTests.includes("astrbot.bakacookie520.top"),
  "E2E tests must not depend on a developer database monitor",
);

console.log("CI E2E runtime contract is complete");
