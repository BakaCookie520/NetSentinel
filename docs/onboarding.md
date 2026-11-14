# 单容器初始化与迁移

## 新安装

默认 Compose 仅启动一个 `NetSentinel` 容器，Web、API、探测调度、工作流执行、
SSE 和 Agent WebSocket 在同一应用内运行。SQLite 是默认选项，不需要 Redis
或 PostgreSQL。选择外部数据库时，只连接你已有的服务，不创建额外数据库容器。

```bash
cp .env.example .env
docker compose up -d
docker compose logs app
```

从日志中的 `NetSentinel setup token:` 或 `/app/data/setup.token` 获取一次性安装令牌，
通过 HTTPS（或本机安全通道）进入四步向导：

1. 确认数据库：SQLite / 外部 PostgreSQL / 外部 Redis，完成连接读写检查。
2. 设置管理员：邮箱、显示名称、至少 12 位密码和确认密码。
3. 保存账户恢复密钥；可选绑定 TOTP 验证器，验证码确认后才启用。
4. 进入控制台。服务端完成初始化后，安装写接口永久关闭。

刷新或重启后可重新用安装令牌解锁并恢复进度；未确认的 TOTP/恢复信息重新生成。
没有默认管理员密码。初始账号不会提前获得业务登录会话。

## 数据持久化

Compose 挂载整个 `/app/data`，不要只挂载单个数据库文件：

| 路径 | 用途 |
| --- | --- |
| `database/netsentinel.sqlite` | SQLite 业务数据库 |
| `database/netsentinel.sqlite-wal`、`-shm` | SQLite WAL 及共享内存文件 |
| `master.key` | 部署加密主密钥 |
| `installation.json` | 加密后的数据库连接及安装状态 |
| `setup.token` | 一次性安装令牌 |
| `avatars/` | 用户头像 |
| `backups/` | 加密备份、策略及恢复日志 |

容器以非特权 `node` 用户运行，命名卷自动继承目录权限；若使用宿主机目录挂载，
应先确保 UID/GID 1000 可写。不要删除卷、改变主密钥或手动编辑安装配置。
SQLite 采用 WAL、外键和串行工作线程，不应将数据库目录放在跨主机网络文件系统。
首版只支持一个活跃应用实例，不支持水平扩容。

不提供 `NETSENTINEL_MASTER_KEY` 时生成随机 32 字节密钥并写入卷；若显式提供的
密钥与卷中已有密钥不一致，启动失败，不会静默换钥。

## 外部数据库

PostgreSQL 使用原有 Prisma 表与增量迁移；新站点应提供专用空数据库，并允许迁移
所需的建表权限。保留原有数据库结构和 `_prisma_migrations`，不需要外部 Redis 队列。

Redis 是完整业务主库，不是缓存。支持单节点 Redis、密码/ACL 用户、TLS、
数据库编号和独立命名空间。必须启用 `appendonly yes` 和 `maxmemory-policy noeviction`；
连接账号必须允许读取这两项配置，无法确认时拒绝初始化。程序不会代为修改外部 Redis。
建议使用专用实例和独立凭据，持久化及备份由数据库管理员负责。

数据库连接凭据只在安装时提交并加密保存，接口不回显。数据源选定后不支持热切换；
更换数据库应新建实例并导入逻辑备份。

## 账户安全

- 账户恢复密钥：仅显示一次，用于忘记密码/验证器后的账户找回。验证后必须保存
  新密钥才会执行重置；重置会关闭原 2FA，撤销所有 Session 和 API Token。
- TOTP：可在安装时跳过，之后从账户菜单的“账户安全”绑定；同一时间步的验证码
  不能再次使用。开启后，密码验证只产生短期挑战，不签发正式 Session。
- TOTP 备用码：十个一次性码，只能作为第二因素，不能单独重置密码。
- TOTP 密钥加密保存；恢复密钥、备用码只保存哈希。
- 恢复密钥不是 `/app/data/master.key`，不能用于解密 SSH/API 凭据。

## 已有 PostgreSQL 站点

**不要直接删旧容器或数据卷，不要执行 `docker compose down -v`。**

1. 导出并异地保存现有加密备份，保留原主密钥以及 PostgreSQL、Redis、app-data 卷。
2. 暂停监控和新工作流提交；等待活动动作完成，排空旧队列。
3. 停止旧 `worker` 和旧 `app`，保留 PostgreSQL 运行。
4. 新应用连接同一 PostgreSQL，挂载原 app-data，提供原
   `NETSENTINEL_MASTER_KEY`、`DATABASE_URL`、公开 `WEB_ORIGIN`。
5. 首次接管时同时提供旧 `REDIS_URL` 以检测未停用的 Worker 或未排空队列。
   若检测失败，先完成排空，不要清空 Redis 绕过。
6. 仅启动新应用；它执行增量迁移并沿用账号，不重新开放首装。
   登录后可非阻断地补全 2FA 和账户恢复密钥。

可通过 Compose override 指定现有网络、外部 app-data 卷和连接变量；不要在外部
PostgreSQL 仍使用 Docker 内部服务名时断开它所在网络。旧的自动生成管理员环境变量
不再用于新安装。

若通过向导连接已存在的 NetSentinel 数据库，会要求使用原管理员密码（以及原 2FA）
接管，不能覆盖创建新管理员。外部实例仍须保留原主密钥。

## 备份迁移与运维

新逻辑备份格式版本为 2，与物理数据库类型无关；支持 SQLite、PostgreSQL、Redis
之间导入。版本 1 的已发布备份经显式旧 schema 校验后转换使用。凭据及 TOTP 秘密
恢复时重新加密为目标实例主密钥，清除 Session 和短时挑战，已消费的备用码不复活。

恢复暂停写入并排空内置任务，覆盖前强制创建保护备份；中断的远程动作标记结果未知，
不自动重放。原站点仍在线时不会自动切换 DNS、流量或 Agent，必须另行切换。
新备份为获得一致快照会短暂停写及暂停调度，大站点建议在低峰执行。

健康检查 `/api/v1/health/ready` 在首装时返回 `status: setup`，完成后返回
`status: ready`、`workerConnected: true`。内置执行器异常时不能伪报正常。
反向代理应支持 `/api/v1/events` 的 SSE 和 `/agent/v1/connect` 的 WebSocket，
上述动态路径不能被 CDN 缓存或注入 Bot/JS 挑战。
