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

NetSentinel 主动探测 HTTP(S)、WebSocket、TCP 和 ICMP 目标，在连接异常时创建事件，并自动或经过审批后执行恢复工作流。管理控制台基于 React、Vite 和 MUI，服务端采用 NestJS、PostgreSQL、Redis 与 BullMQ。

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

编辑 `.env`，至少替换数据库密码、初始管理员密码和主密钥。主密钥可通过下面的命令生成：

```bash
openssl rand -base64 32
```

构建并启动全部服务：

```bash
docker compose up --build -d
docker compose ps
```

打开 `http://localhost:8080`，使用 `.env` 中的 `INITIAL_ADMIN_EMAIL` 和 `INITIAL_ADMIN_PASSWORD` 登录。管理员创建成功后应从 `.env` 删除初始密码；后续启动不会使用它覆盖现有账户。

停止服务但保留 PostgreSQL 和 Redis 数据：

```bash
docker compose down
```

> 不要使用 `docker compose down -v`，除非确定要删除数据库和队列数据。

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

前端默认使用交互式演示数据。连接真实 API 时将 `VITE_DEMO_MODE` 设置为 `false`。完整启动 API 和 worker 还需要 PostgreSQL、Redis，并需要把 `.env.example` 中的变量加载到当前终端环境；首次安装建议使用上面的 Docker 方式。

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

恢复脚本会停止 API 和 worker，并在替换数据库前要求确认。升级前应备份 PostgreSQL，并定期验证备份能否恢复。

## Linux Agent

Linux Agent 只通过出站 WSS 连接服务器，不开放宿主机入站端口。安装 Node.js 22 后，可在 Windows 上生成安装包：

```powershell
./infra/package-agent.ps1 -Version 0.1.0
```

也可以下载 `agent-v*` 标签生成的发行包，在 Linux 上解压并以 root 运行 `install.sh`，然后配置 `/etc/netsentinel-agent.env`。需要特权命令时应使用最小权限的 sudoers 白名单，不要在 NetSentinel 中保存 sudo 密码。

## 安全说明

- 将 `NETSENTINEL_MASTER_KEY` 保存在 Docker Secret 或其他秘密管理系统中；丢失主密钥后，已保存凭据无法恢复。
- 容器 Shell 以非特权 `node` 用户运行，并且不会挂载 Docker Socket。
- Worker 仅为 ICMP 探测增加 `NET_RAW` 能力。
- 当前 SSH 动作默认接受目标服务器提供的任意主机密钥，无法防止 SSH 中间人攻击；请只在可信网络路径中使用。
- 对外开放前请使用 HTTPS 反向代理保护实例，不要直接暴露 HTTP 管理端口。

## 验证

```powershell
pnpm test
pnpm typecheck
pnpm build
```

CI 还会使用真实 PostgreSQL、Redis、API 和 Playwright 执行浏览器流程测试。
