<p align="center">
  <img src="./apps/web/public/favicon.svg" width="72" height="72" alt="NetSentinel icon">
</p>

<h1 align="center">NetSentinel</h1>

<p align="center">
  A self-hosted network monitoring and automated recovery platform
</p>

<p align="center">
  <a href="./README.md">简体中文</a> | <strong>English</strong>
</p>

NetSentinel actively probes HTTP(S), WebSocket, TCP, and ICMP targets. It opens incidents when connections fail and runs recovery workflows automatically or after approval. The management console uses React, Vite, and MUI; the backend uses NestJS, PostgreSQL, Redis, and BullMQ.

## Features

- Active HTTP/HTTPS, WS/WSS, TCP, and ICMP probes.
- Configurable consecutive failure and recovery thresholds.
- HTTP status, duration, text, RE2 regular expression, and JSONPath assertions.
- SSH, HTTP API, webhook, container shell, Linux agent shell, and SMTP email actions.
- Automatic or approval-gated workflows with timeouts, limited retries, and continue-on-failure behavior.
- Incident acknowledgement, assignment, comments, timelines, runtime logs, and audit logs.
- AES-256-GCM encrypted credentials with no secret values returned by the API.
- An anonymous public status page with 90-day availability and sanitized incidents.
- Simplified Chinese and English, light and dark modes, and configurable theme colors.

## Quick Start With Docker

Docker Engine and Docker Compose v2 are required.

```bash
git clone https://github.com/BakaCookie520/NetSentinel.git
cd NetSentinel
cp .env.example .env
```

Edit `.env` and replace at least the database password, initial administrator password, and master key. Generate a master key with:

```bash
openssl rand -base64 32
```

Build and start the complete stack:

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:8080` and sign in with `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`. Remove the initial password from `.env` after the administrator is created; later starts never use it to overwrite an existing account.

Stop the stack while preserving PostgreSQL and Redis data:

```bash
docker compose down
```

> Do not run `docker compose down -v` unless you intend to delete the database and queue data.

## GHCR Images

Every push to `main` publishes these images after the complete CI suite succeeds:

```text
ghcr.io/bakacookie520/netsentinel-server:latest
ghcr.io/bakacookie520/netsentinel-web:latest
```

Each release also receives a `sha-<commit>` tag for pinned deployments and rollbacks. Private images require a token with `read:packages` permission:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u BakaCookie520 --password-stdin
docker pull ghcr.io/bakacookie520/netsentinel-server:latest
docker pull ghcr.io/bakacookie520/netsentinel-web:latest
```

## Local Frontend Development

Node.js 22 and pnpm 10 are required.

```powershell
pnpm install
pnpm --filter @netsentinel/web dev
```

The frontend uses interactive demo data by default. Set `VITE_DEMO_MODE=false` to connect it to the real API. Running the complete API and worker stack also requires PostgreSQL, Redis, and the variables from `.env.example` loaded into the current shell; the Docker setup above is recommended for a first installation.

## Public Status Page

The anonymous status page is available at `/status`. Existing monitors are initially published by the public-status migration; newly created monitors remain private until an administrator enables public visibility in the monitor editor.

The title, description, support URL, enabled state, and theme color are configured under **System Settings > Public Status Page**. The public API is:

```text
GET /api/v1/public/status
```

It never returns target addresses, protocol configuration, credentials, internal errors, comments, or workflow data.

For a dedicated status domain, proxy the domain root to `http://127.0.0.1:8080` and redirect visitors to `/status`. Do not proxy every static asset request to the upstream `/status` path.

## Operations Endpoints

- OpenAPI: `/api/docs`
- Health checks: `/api/v1/health/*`
- Prometheus metrics: `/api/v1/metrics`
- Application timestamps are stored in UTC and displayed in the user's configured timezone.

## Backup And Restore

```powershell
./infra/backup.ps1
./infra/restore.ps1
```

The restore script stops the API and worker and asks for confirmation before replacing the database. Back up PostgreSQL before upgrades and regularly test that backups can be restored.

## Linux Agent

The Linux agent connects to the server over outbound WSS and opens no inbound host port. After installing Node.js 22, build an installation archive on Windows with:

```powershell
./infra/package-agent.ps1 -Version 0.1.0
```

You can also download a release generated from an `agent-v*` tag. Extract it on Linux, run `install.sh` as root, and configure `/etc/netsentinel-agent.env`. Grant privileged commands through a minimal sudoers allowlist; never store a sudo password in NetSentinel.

## Security Notes

- Store `NETSENTINEL_MASTER_KEY` in Docker Secret or another secret manager. Losing it makes stored credentials unrecoverable.
- Container shell steps run as the unprivileged `node` user and do not receive the Docker socket.
- Only the worker receives the `NET_RAW` capability required for ICMP probes.
- SSH actions currently accept any host key presented by the target and therefore do not prevent SSH man-in-the-middle attacks. Use them only over a trusted network path.
- Put the service behind an HTTPS reverse proxy before exposing it publicly; do not expose the plain HTTP management port directly.

## Validation

```powershell
pnpm test
pnpm typecheck
pnpm build
```

CI also runs browser flows against real PostgreSQL, Redis, and API services with Playwright.
