<p align="center">
  <img src="./apps/web/public/favicon.svg" width="72" height="72" alt="NetSentinel 图标">
</p>

<h1 align="center">NetSentinel</h1>

<p align="center">
  自托管的网络监测与自动恢复平台
</p>

<p align="center">
  <strong>简体中文</strong> | <a href="./README.en.md">English</a>
</p>

NetSentinel 主动探测 HTTP(S)、WebSocket、TCP 和 ICMP 目标，在连接异常时创建事件，并自动或经过审批后执行恢复工作流。管理控制台基于 React、Vite 和 MUI，Node 服务集成 API 与持久化任务执行器，业务数据库可选内置 SQLite、外部 PostgreSQL 或外部 Redis。

## 主要功能

- 支持 HTTP/HTTPS、WS/WSS、TCP 和 ICMP 主动探测。
- 使用连续失败和连续成功阈值判断性能波动、中断与恢复。
- 支持 HTTP 状态码、耗时、文本、RE2 正则和 JSONPath 断言。
- 支持 SSH、HTTP API、Webhook、容器 Shell、Linux Agent Shell 和 SMTP 邮件动作。
- 工作流支持自动执行、人工审批、超时、有限重试和失败后继续。
- 提供事件确认、指派、备注、时间线、运行日志和审计日志。
- 凭据使用 AES-256-GCM 加密保存，敏感字段不会通过 API 回显。
- 提供无需登录的公开状态页，可展示 90 天可用率和脱敏事件。
- 支持简体中文/英文、浅色/深色模式以及可配置主题色。

## Docker 快速部署

需要 Docker Engine 和 Docker Compose v2。

```bash
git clone https://github.com/BakaCookie520/NetSentinel.git
cd NetSentinel
cp .env.example .env
```

新安装无需预填数据库或初始管理员密码。默认只启动一个应用容器：

```bash
docker compose up --build -d
docker compose ps
docker compose logs app
```

打开 `http://localhost:8080`，使用日志中的一次性安装令牌，依次选择数据库、设置管理员、保存账户恢复密钥（可选开启验证器 2FA），最后进入控制台。数据库连接和部署主密钥保存在 `/app/data` 持久化卷。详见 [初始化与迁移](docs/onboarding.md)。

停止服务但保留持久化数据：

```bash
docker compose down
```

> 不要使用 `docker compose down -v`。旧站点不要直接套用新 Compose：先备份、停止旧 Worker 并排空队列，保留旧数据库和主密钥后按迁移文档接管。

## GHCR 镜像

每次推送到 `main` 且 CI 全部通过后，GitHub Actions 会自动发布以下统一 Web 与 API 镜像：

```text
ghcr.io/bakacookie520/netsentinel:latest
```

每次发布还会生成 `sha-<提交号>` 标签，用于固定版本和回滚。私有镜像需要先使用具有 `read:packages` 权限的令牌登录：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u BakaCookie520 --password-stdin
docker pull ghcr.io/bakacookie520/netsentinel:latest
```

## 本地前端开发

需要 Node.js 22 和 pnpm 10。

```powershell
pnpm install
pnpm --filter @netsentinel/web dev
```

前端默认使用交互式演示数据。连接真实 API 时将 `VITE_DEMO_MODE` 设置为 `false`。先执行 `pnpm build`，设置 `NETSENTINEL_DATA_DIR` 为可写的本地目录，然后运行 `node apps/api/dist/main.js`。SQLite 模式无需 PostgreSQL 或 Redis。

## 公开状态页

匿名状态页位于 `/status`。现有监控会在公开状态页迁移中首次公开，新建监控默认保持私有，管理员可在监控编辑器中单独开启公开展示。

标题、说明、支持链接、启用状态和主题色可在“系统设置 > 公开状态页”中配置。公开 API 为：

```text
GET /api/v1/public/status
```

该接口不会返回目标地址、协议配置、凭据、内部错误、备注或工作流信息。

反向代理独立状态域名时，应将域名根路径代理到 `http://127.0.0.1:8080`，再把访问者重定向到 `/status`；不要把所有静态资源请求直接代理到上游的 `/status`。

## 运维接口

- OpenAPI：`/api/docs`
- 健康检查：`/api/v1/health/*`
- Prometheus 指标：`/api/v1/metrics`
- 所有应用时间以 UTC 保存，界面按用户设置的时区显示。

## 备份与恢复

```powershell
./infra/backup.ps1
./infra/restore.ps1
```

上述脚本仅适用于旧的 PostgreSQL/Redis 分离部署。新部署使用控制台的“备份与恢复”，逻辑备份可在三种数据库之间迁移。数据库切换需在新实例导入备份，不支持运行中热切换。

## Linux Agent

Linux Agent 只通过出站 WSS 连接服务器，不开放宿主机入站端口。安装 Node.js 22 后，可在 Windows 上生成安装包：

```powershell
./infra/package-agent.ps1 -Version 0.1.0
```

也可以下载 `agent-v*` 标签生成的发行包，在 Linux 上解压并以 root 运行 `install.sh`，然后配置 `/etc/netsentinel-agent.env`。需要特权命令时应使用最小权限的 sudoers 白名单，不要在 NetSentinel 中保存 sudo 密码。

## 安全说明

- 默认部署主密钥位于 `/app/data/master.key`；也可通过 `NETSENTINEL_MASTER_KEY` 提供，二者冲突时拒绝启动。请备份整个持久化目录。
- 账户恢复密钥用于重置密码，不是部署主密钥；TOTP 备用码仅用于替代第二因素。
- 容器 Shell 以非特权 `node` 用户运行，并且不会挂载 Docker Socket。
- 单应用容器仅为 ICMP 探测增加 `NET_RAW` 能力，不需要特权模式或 Docker Socket。
- 当前 SSH 动作默认接受目标服务器提供的任意主机密钥，无法防止 SSH 中间人攻击；请只在可信网络路径中使用。
- 对外开放前请使用 HTTPS 反向代理保护实例，不要直接暴露 HTTP 管理端口。

## 验证

```powershell
pnpm test
pnpm typecheck
pnpm build
```

CI 还会使用真实 PostgreSQL、Redis、API 和 Playwright 执行浏览器流程测试。

## 备份与恢复

管理导航中的「备份与恢复」支持独立口令加密、手动/定时完整站点备份、导入导出和
覆盖恢复。备份与头像保存在现有 `app-data` 卷中。使用方法和恢复注意事项见
[备份说明](docs/backups.md)。旧四容器站点升级前必须按[迁移步骤](docs/onboarding.md)停用旧 Worker。
