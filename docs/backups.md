# 备份与恢复 / Backups and recovery

管理员在「备份与恢复」页面设置独立备份口令（至少 12 位），然后创建手动备份，
或启用每天/每周的定时备份。默认每天 03:00，时区默认为 UTC，保留 7 份成功的
定时备份。手动、导入和恢复前保护备份不会自动清理。

备份包含完整业务数据库（含账户安全信息）和引用的头像，不包含登录 Session、临时任务、环境变量、
既有备份或本机调度配置。文件采用 scrypt + AES-256-GCM 加密，扩展名 `.nsbackup`。
导入需要来源备份口令；导入仅校验和保存，**不会自动恢复**。

## 恢复前

- 新格式版本 2 按逻辑 schema 校验，允许三种数据库之间迁移；版本 1 先经过旧 schema 校验再转换，不自动猜测未知版本。
- 导出并异地保存备份。服务器或磁盘丢失会同时丢失本机副本。
- 保存备份口令；口令遗失无法恢复。更改口令只影响新备份。
- 单容器模式使用内置执行器；旧部署应先完成[迁移](onboarding.md)，避免原 Worker 与新执行器同时运行。
- 恢复会覆盖账户、角色和密码。恢复后使用备份中的账户重新登录。
- 新服务器恢复时，凭据会重新加密到目标主密钥；不要替换目标 `.env`。
- 保持原服务器同时运行不会自动切换流量或 Agent，请另外安排切换。

恢复需要当前账户密码和 `RESTORE` 确认。系统暂停写入及任务调度、等待活动任务结束，
先创建保护备份，再事务替换数据库与暂存头像。未完成的工作流不重放，待审批操作取消。
失败且未提交时保留当前数据；数据库已提交但文件切换中断时保持维护状态，重启 app
后依据持久化日志继续完成，不能手动删恢复日志或数据库检查点绕过保护。

## 存储与限制

全部文件位于 `${NETSENTINEL_DATA_DIR:-/app/data}/backups`，头像位于同级 `avatars`。
Compose 已使用 `app-data` 命名卷，不增加容器或 Docker Socket。卷备份需包含整个
`app-data`（包含 `master.key`）以及显式提供的 `NETSENTINEL_MASTER_KEY`；独立导出的
`.nsbackup` 则只需来源备份口令和兼容逻辑 schema。恢复时凭据和 TOTP 密钥重新加密，
已消费的备用码不复活；导出的备份本身仍包含来源时点的恢复密钥哈希，请妥善保管。

| 环境变量 | 默认值 |
| --- | --- |
| `NETSENTINEL_BACKUP_UPLOAD_MAX_BYTES` | `1073741824`（1 GiB） |
| `NETSENTINEL_BACKUP_EXPANDED_MAX_BYTES` | `10737418240`（10 GiB） |
| `NETSENTINEL_RESTORE_DRAIN_TIMEOUT_MS` | `600000`（10 分钟） |

大文件导入时相应调整反向代理请求体大小与超时。定时任务每 30 秒检查一次，到点后
当天只尝试一次；应用错过当天计划但当天稍后启动时补做一次，不补做历史日期。
导入和快照验证需要展开暂存空间。空间不足、任务排空超时或保护备份失败都会中止恢复。

## Permissions and API

Only session-authenticated users with `backup:manage` can access
`/api/v1/admin/backups`. Existing built-in administrators receive the permission
through migration. API tokens are rejected, writes require CSRF, and download /
restore require the current account password. Backup passphrases and source master
keys are never returned in metadata or written to audit logs.

The API provides list/detail, create, import, update name/note, delete,
POST `:id/download`, POST `:id/restore`, GET/PUT `policy`, and GET `jobs/:id`.
Create/import/restore return HTTP 202 with a persisted job ID. Restore confirmation
must be `RESTORE`; all sessions expire after database replacement.

Destructive integration tests require an explicitly named `backup_test` database,
a non-default isolated Redis port, and `NETSENTINEL_BACKUP_INTEGRATION=true`.
Never point those tests at a production database.

New storage tests use `ONBOARDING_POSTGRES_URL` pointing to a dedicated test
database and `ONBOARDING_REDIS_URL` pointing to isolated AOF/noeviction Redis.
Without these variables the suite runs SQLite only. CI tests all nine backup
source/target combinations and isolated single-container persistence.
