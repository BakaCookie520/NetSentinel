# NetSentinel

NetSentinel is a self-hosted network monitor and guarded automation console. It probes HTTP(S), WS(S), TCP, and ICMP targets, opens incidents after configurable failure thresholds, and runs ordered recovery workflows automatically or after approval.

## Development UI

```powershell
pnpm install
pnpm --filter @netsentinel/web dev
```

The development UI uses interactive demo data unless `VITE_DEMO_MODE=false` is set.

## Production deployment

1. Copy `.env.example` to `.env` and replace every placeholder. Generate the master key with `openssl rand -base64 32`.
2. Start the stack with `docker compose up --build -d`.
3. Open `http://localhost:8080` and sign in with `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`.
4. Remove the initial password from `.env` after the administrator has been created; it is never used to overwrite an existing account.

The API is documented at `/api/docs`. Health checks are under `/api/v1/health/*`, Prometheus metrics are at `/api/v1/metrics`, and all application timestamps are stored in UTC.

## Security notes

- Keep `NETSENTINEL_MASTER_KEY` in a Docker secret or equivalent secret manager. Losing it makes stored credentials unrecoverable.
- Container shell steps run as the unprivileged `node` user and do not receive the Docker socket.
- Linux host commands require the separately installed agent and its one-time enrollment token.
- SSH steps currently accept every server host key. Use a trusted network path because this does not protect against SSH man-in-the-middle attacks.
- Back up PostgreSQL regularly with `infra/backup.ps1`; test restores before upgrades.

Restore a backup with `infra/restore.ps1`; it stops API/worker and asks for confirmation before replacing the database. CI validates tests, types, builds, and browser flows. Tags matching `agent-v*` publish a versioned Linux agent archive and SHA-256 checksum.

## Linux agent

Install Node.js 22, build a local package with `infra/package-agent.ps1 -Version 0.1.0`, or download a release generated from an `agent-v*` tag. Extract it and run `install.sh` as root, then configure `/etc/netsentinel-agent.env`. Grant any required privileged commands through a minimal host-managed sudoers allowlist; never store a sudo password in NetSentinel.

## Validation

```powershell
pnpm test
pnpm typecheck
pnpm build
```
## Public status page

The anonymous status page is available at `/status`. Existing monitors are published by migration `0004_public_status_page`; monitors created afterward remain private until an administrator enables **公开到状态页** in the monitor editor.

Status-page title, description, support URL, enabled state, and theme color are persisted under **系统设置 > 公开状态页**. The public API is `GET /api/v1/public/status` and intentionally excludes monitor targets, protocol configuration, credentials, internal errors, comments, and workflow data.
