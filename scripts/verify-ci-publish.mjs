import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

for (const requiredFragment of [
  "publish:",
  "needs: verify",
  "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  "packages: write",
  "ghcr.io/bakacookie520/netsentinel",
  "file: Dockerfile",
  "docker/setup-buildx-action@v4",
  "docker/login-action@v4",
  "docker/metadata-action@v6",
  "docker/build-push-action@v7",
  "type=raw,value=latest",
  "type=sha,prefix=sha-,format=short",
  "VITE_DEMO_MODE=false",
  "push: true",
]) {
  assert(workflow.includes(requiredFragment), `CI image publishing must include: ${requiredFragment}`);
}

for (const retiredFragment of [
  "ghcr.io/bakacookie520/netsentinel-server",
  "ghcr.io/bakacookie520/netsentinel-web",
  "Dockerfile.server",
  "apps/web/Dockerfile",
]) {
  assert(!workflow.includes(retiredFragment), `CI image publishing must not include retired deployment target: ${retiredFragment}`);
}

console.log("CI GHCR publishing contract is complete");
