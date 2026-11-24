const messages: Readonly<Record<string, string>> = {
  AUTH_2FA_ALREADY_ENABLED: "已启用双重验证。",
  AUTH_2FA_INVALID: "验证码或备用码无效、已过期或已使用，请重新输入。",
  AUTH_CSRF: "请求验证失败，请刷新页面后重试。",
  AUTH_FORBIDDEN: "当前账户没有执行此操作的权限。",
  AUTH_INVALID: "身份验证失败，请核对输入或重新登录。",
  AUTH_SESSION_REQUIRED: "请使用网页登录后再执行此操作。",
  AVATAR_REQUIRED: "请选择要上传的头像。",
  "Avatar must be 2 MB or smaller": "头像不能超过 2 MB。",
  "Avatar must be a PNG, JPEG, or WebP image": "请选择 PNG、JPEG 或 WebP 图片。",
  BACKUP_GROUP_UNAVAILABLE: "备份不包含所选分组。",
  BACKUP_DEPENDENCY_CONFLICT: "所选分组与其他数据的引用关系冲突。未替换任何数据。请检查分组或选择兼容的备份。",
  MAIL_DISABLED: "邮件服务未启用。",
  MAIL_CREDENTIAL_REQUIRED: "请输入 SMTP 认证密码。",
  MAIL_RATE_LIMIT: "发送过于频繁，请稍后再试。",
  MAIL_ADDRESS_IN_USE: "此邮箱不能用于该账户。",
  MAIL_CODE_INVALID: "邮件验证码无效、已使用或已过期。",
  SMTP_DELIVERY_FAILED: "SMTP 发送失败。请检查服务器、TLS、发件地址和认证设置。",
  BACKUP_ADMIN_MISSING: "备份中没有可用的管理员账户。",
  BACKUP_AVATAR_INVALID: "备份中的头像文件无效。",
  BACKUP_AVATAR_MISSING: "备份恢复所需的头像文件缺失。",
  BACKUP_BUSY: "另一个备份操作正在执行，请稍后重试。",
  BACKUP_COUNTS_INVALID: "备份中的记录数量校验失败。",
  BACKUP_CURRENT_PASSWORD_INVALID: "当前账户密码不正确。",
  BACKUP_DISK_FULL: "可用磁盘空间不足，备份操作已停止。",
  BACKUP_DRAIN_TIMEOUT: "运行中的任务未及时结束，备份操作已中止。",
  BACKUP_DUPLICATE: "备份中存在重复记录。",
  BACKUP_EXPANDED_LIMIT: "备份展开后超过容量上限。",
  BACKUP_FILE_INVALID: "文件不是有效的 NetSentinel 备份。",
  BACKUP_INTERRUPTED: "备份操作因应用重启中断，请重试。",
  BACKUP_NOT_READY: "这份备份尚未就绪，请稍后重试。",
  BACKUP_OPERATION_FAILED: "备份操作失败，请检查服务日志后重试。",
  BACKUP_PASSWORD_OR_FILE_INVALID: "备份口令错误，或备份文件已损坏。",
  BACKUP_PASSWORD_REQUIRED: "请先在备份策略中设置独立备份口令。",
  BACKUP_RECORD_TOO_LARGE: "备份中的单条记录超过大小限制。",
  BACKUP_RELATION_INVALID: "备份中的数据关联不完整。",
  BACKUP_RESERVED_SETTING: "备份中包含不允许导入的系统设置。",
  BACKUP_ROW_INVALID: "备份中的记录格式不正确。",
  BACKUP_SCHEMA_MISMATCH: "备份结构与当前版本不兼容，请使用兼容的 NetSentinel 版本。",
  BACKUP_UNKNOWN_TABLE: "备份中包含当前格式不支持的数据表。",
  BACKUP_WORKER_UPGRADE_REQUIRED: "请先升级所有执行器，再恢复备份。",
  BACKUP_WRITERS_TIMEOUT: "等待其他写入操作超时，备份操作已中止。",
  CONFIG_INVALID: "配置不完整或无效，请检查后重试。",
  "CONFIG_INVALID: incomplete action": "动作配置不完整，请检查工作流设置。",
  CREDENTIAL_INCOMPATIBLE: "所选凭据不适用于当前监控或动作类型。",
  EGRESS_BLOCKED: "目标地址被出口访问策略阻止。",
  HANDSHAKE_FAILED: "连接握手失败，请检查服务地址和连接配置。",
  ICMP_FAILED: "目标未通过 ICMP 探测，请检查目标和网络。",
  INSTANCE_ALREADY_ACTIVE: "已有 NetSentinel 实例在使用此数据源。",
  INSTANCE_LEASE_LOST: "当前实例已失去执行权，请检查是否启动了重复实例。",
  INSTANCE_LOCK_INVALID: "实例锁状态异常，请检查服务器日志。",
  JSON_ASSERTION_FAILED: "响应的 JSON 内容不符合断言条件。",
  LATENCY_ASSERTION_FAILED: "响应时间超过配置的限制。",
  LEGACY_QUEUE_CHECK_REQUIRED: "请连接旧版 Redis 队列以检查是否可以接管。",
  LEGACY_QUEUE_MUST_DRAIN: "旧版队列仍有未完成的任务，请排空队列后重试。",
  LEGACY_WORKER_MUST_STOP: "请先停止旧版执行器，再接管站点。",
  LIMIT_FILE_SIZE: "文件超过允许的上传大小。",
  MASTER_KEY_CONFLICT: "配置的主密钥与数据卷中的主密钥不一致，请使用原主密钥。",
  MASTER_KEY_INVALID: "部署主密钥格式无效，请检查配置。",
  MESSAGE_ASSERTION_FAILED: "收到的消息不符合断言条件。",
  NETWORK_ERROR: "网络连接失败，请检查网络和服务地址后重试。",
  NO_DATA: "没有收到预期的数据。",
  NO_RESPONSE: "目标未返回响应。",
  NOT_FOUND: "请求的数据不存在，可能已被删除。",
  OPERATION_FAILED: "操作失败，请稍后重试；若问题持续，请检查服务日志。",
  ORIGIN_NOT_ALLOWED: "当前访问地址未获允许，请核对网址与服务器配置的 WEB_ORIGIN（包含协议和端口）。",
  PASSWORD_CHANGE_REQUIRED: "请先修改密码，再继续使用控制台。",
  PASSWORD_MISMATCH: "两次输入的密码不一致。",
  PASSWORD_UNCHANGED: "新密码不能与当前密码相同。",
  REDIS_NAMESPACE_INVALID: "Redis 命名空间无效，请使用字母、数字、下划线或连字符。",
  REDIS_REQUIRES_AOF_NOEVICTION: "Redis 必须启用 AOF 并配置为不淘汰数据，且连接账户需要能读取配置。",
  REGEX_ASSERTION_FAILED: "响应内容不符合配置的正则表达式。",
  RESTORE_IN_PROGRESS: "系统正在备份或恢复数据，请等待操作完成后重试。",
  ROLE_SYSTEM: "内置系统角色不能修改。",
  RUNTIME_UNAVAILABLE: "任务执行器暂不可用，请检查系统状态后重试。",
  SETTING_INVALID: "设置值无效，请检查输入。",
  SETUP_ACCOUNT_REQUIRED: "请先设置初始管理员账户。",
  SETUP_BUSY: "正在处理另一项安装操作，请稍后重试。",
  SETUP_CLOSED: "站点已完成初始化，不需要重新安装。",
  SETUP_DATABASE_NOT_EMPTY: "所选数据库已包含数据，请改用专用的空数据库或接管已有站点。",
  SETUP_DATABASE_REQUIRED: "请先选择并确认数据库。",
  SETUP_EXISTING_SITE: "检测到已有站点，请使用原管理员账户接管。",
  SETUP_ORIGIN_INVALID: "安装过程中访问地址发生变化，请从同一地址重新验证安装令牌。",
  SETUP_REQUIRED: "请先完成站点初始化。",
  SETUP_SECURITY_REQUIRED: "请先完成安全设置并确认已保存恢复密钥。",
  SETUP_UNAUTHORIZED: "安装令牌不正确，或安装会话已过期，请重新验证。",
  STATUS_ASSERTION_FAILED: "响应状态码不符合配置的条件。",
  STORAGE_CONFLICT: "数据已发生变化，请刷新后重试。",
  STORAGE_DUPLICATE: "相同的数据已存在，请检查输入。",
  STORAGE_IN_USE: "此项目仍被其他数据引用，请先解除关联。",
  STORAGE_RECOVERY_REQUIRED: "数据库正在等待恢复，请联系管理员检查服务日志。",
  STORAGE_RELATION_INVALID: "关联的数据不存在或无效，请检查配置。",
  STORAGE_SCHEMA_MISMATCH: "数据库结构与当前程序版本不兼容。",
  TARGET_BLOCKED: "目标地址被出口访问策略阻止。",
  TEXT_ASSERTION_FAILED: "响应内容不包含预期文本。",
  TIMEOUT: "等待响应超时，请检查目标服务和超时设置。",
  TOO_MANY_REDIRECTS: "目标重定向次数过多，请检查访问地址。",
  TOTP_SECRET_INVALID: "验证器密钥无效，请重新绑定。",
  TRUST_PROXY_MUST_BE_EXPLICIT: "请明确配置受信任的代理，不能直接信任所有代理。",
  WORKFLOW_RUNNING: "此工作流仍有未结束的任务，请等待完成后再操作。",
  "Agent offline": "执行代理不在线，请检查代理连接。",
  "Command could not start": "无法启动命令，请检查执行环境。",
  "Command timed out; result uncertain": "命令执行超时，结果不确定，请先核对目标状态。",
  "SSH command could not start": "无法启动 SSH 命令，请检查连接和命令配置。",
  "SSH disconnected; result uncertain": "SSH 连接已断开，执行结果不确定，请先核对目标状态。",
  "SSH timed out; result uncertain": "SSH 执行超时，结果不确定，请先核对目标状态。",
  "Action failed; remote result may be uncertain": "动作执行失败，远端结果可能不确定，请先核对目标状态。",
  "Execution interrupted; remote result uncertain": "执行中断，远端结果不确定，请先核对目标状态。",
  "Too many redirects": "目标重定向次数过多，请检查访问地址。",
};

const statusMessages: Readonly<Record<number, string>> = {
  400: "请求参数无效，请检查输入后重试。",
  401: "身份验证失败或登录已过期，请重新登录。",
  403: "当前账户没有执行此操作的权限。",
  404: messages.NOT_FOUND!,
  409: "数据状态已发生变化，请刷新后重试。",
  413: messages.LIMIT_FILE_SIZE!,
  422: "输入内容未通过校验，请检查表单。",
  429: "操作过于频繁，请稍后重试。",
  503: "服务暂不可用，请稍后重试。",
};

export function errorText(error: unknown, fallback = "操作失败，请稍后重试。"): string {
  const issues = error instanceof Error ? (error as Error & { errors?: ValidationIssue[] }).errors : undefined;
  if (Array.isArray(issues) && issues.length) return `请检查输入。${validationSummary(issues)}`;
  const detail = typeof error === "string" ? error.trim() : error instanceof Error ? error.message.trim() : "";
  const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
  if (Object.hasOwn(messages, detail)) return messages[detail]!;
  if (/^STORAGE_(?:BOOLEAN|DATE|ENTITY|ENUM|FIELD|INTEGER|LIST|NULL|STRING)_INVALID$/u.test(detail)) return "数据字段不符合要求，请检查输入。";
  if (/^STORAGE_/u.test(detail)) return "数据库操作失败，请检查存储连接或服务日志。";
  if (/^BACKUP_/u.test(detail)) return messages.BACKUP_OPERATION_FAILED!;
  if (/\p{Script=Han}/u.test(detail)) return detail;
  if (error instanceof TypeError && status === undefined) return messages.NETWORK_ERROR!;
  if (status !== undefined) {
    return statusMessages[status] ?? (status >= 500 ? "服务器发生异常，请稍后重试。" : fallback);
  }
  return fallback;
}

type ValidationIssue = {
  path?: readonly PropertyKey[] | string;
  code?: string;
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
  format?: string;
};

export function validationText(issue: ValidationIssue): string {
  if (/\p{Script=Han}/u.test(issue.message)) return issue.message;
  const minimum = issue.minimum?.toString() ?? /(?:>=|≥)\s*(\d+)/u.exec(issue.message)?.[1];
  const maximum = issue.maximum?.toString() ?? /(?:<=|≤)\s*(\d+)/u.exec(issue.message)?.[1];
  const lengthUnit = issue.origin === "array" || /\barray\b/iu.test(issue.message) ? "项" : "个字符";
  const numeric = issue.origin === "number" || /\bnumber\b/iu.test(issue.message);
  if ((issue.code === "too_small" || /^Too small/iu.test(issue.message)) && minimum) {
    return numeric ? `数值不能小于 ${minimum}。` : `至少需要 ${minimum} ${lengthUnit}。`;
  }
  if ((issue.code === "too_big" || /^Too (?:big|large)/iu.test(issue.message)) && maximum) {
    return numeric ? `数值不能大于 ${maximum}。` : `最多允许 ${maximum} ${lengthUnit}。`;
  }
  if (issue.format === "email" || /\bemail\b/iu.test(issue.message)) return "请输入有效的邮箱地址。";
  if (issue.format === "url" || /\burl\b/iu.test(issue.message)) return "请输入有效的网址。";
  if (/\bundefined\b/iu.test(issue.message)) return "请填写此项。";
  if (issue.code === "invalid_value" || /^Invalid (?:option|enum value)/iu.test(issue.message)) return "请选择允许的选项。";
  if (issue.code === "invalid_type" || /^Invalid (?:input|type)/iu.test(issue.message)) return "输入的数据类型或格式不正确。";
  return "输入不符合要求，请检查该项。";
}

const fields: Readonly<Record<string, string>> = {
  backupId: "备份编号", code: "验证码", config: "配置", confirmation: "确认内容",
  currentPassword: "当前密码", displayName: "显示名称", email: "邮箱", headers: "请求头",
  intervalSeconds: "探测间隔", name: "名称", namespace: "命名空间", newPassword: "新密码",
  password: "密码", recoveryKey: "恢复密钥", retain: "保留数量", steps: "步骤",
  target: "目标", timeoutMs: "超时时间", timezone: "时区", token: "令牌", type: "类型",
  url: "地址", username: "用户名",
};

export function validationSummary(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path.map(String) : String(issue.path ?? "").split(".");
    const label = path.filter(Boolean).map((part) => /^\d+$/u.test(part) ? `第 ${Number(part) + 1} 项` : Object.hasOwn(fields, part) ? fields[part] : undefined).filter(Boolean).join(" › ");
    const reason = validationText(issue);
    return label ? `${label}：${reason}` : reason;
  }).filter((message, index, all) => all.indexOf(message) === index).join(" ");
}
