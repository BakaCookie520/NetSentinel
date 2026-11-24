import i18n from "./i18n";
const zh = {
  title: "开始使用 NetSentinel", subtitle: "选择存储，创建管理员，保护你的账户。", steps: ["确认数据库", "管理员账号", "安全信息", "开始使用"],
  token: "一次性安装令牌", tokenHint: "从容器启动日志或 /app/data/setup.token 获取。", unlock: "验证安装令牌", next: "下一步", back: "上一步",
  database: "数据库类型", sqlite: "内置 SQLite", postgresql: "外部 PostgreSQL", redis: "外部 Redis", sqliteHint: "无需外部数据库。文件保存在 /app/data/database/netsentinel.sqlite，请持久化整个 /app/data 目录。",
  host: "服务器地址", port: "端口", username: "数据库用户名", dbPassword: "数据库密码", dbName: "数据库名称", dbNumber: "Redis 数据库编号", namespace: "Redis 命名空间", tls: "启用 TLS", redisHint: "Redis 必须开启 AOF 并使用 noeviction；数据库用于保存全部业务数据，不只是缓存。",
  loginPassword: "密码", signingIn: "正在登录…",
  accountName: "账号名称", identifier: "账号名称或邮箱", accountNameHint: "可使用字母、数字、点、下划线和连字符。邮箱可在登录后绑定。",
  email: "邮箱", displayName: "显示名称", password: "管理员密码", confirmPassword: "再次输入密码", passwordHint: "至少 12 位，不使用初始默认密码。",
  enableTotp: "启用验证器双重认证（可跳过）", code: "动态验证码或备用码", secret: "手动绑定密钥", recovery: "账户恢复密钥", recoveryHint: "仅显示一次，可用于忘记密码时找回账户；它不是部署主密钥，不能解密凭据。",
  saved: "我已安全保存恢复密钥和备用码", backupCodes: "一次性备用码", download: "下载安全信息", finish: "完成初始化", ready: "初始化完成", readyHint: "数据库与内置任务执行器已就绪。", start: "进入控制台", https: "请通过 HTTPS 或本机安全通道完成初始化和账户恢复。",
  existing: "检测到已有站点，请使用原管理员账号接管，不会覆盖数据。", adopt: "接管已有站点", pending: "正在处理…", retry: "重试", required: "请先完成此步骤。", accountSecurity: "账户安全", securityHint: "管理验证器、账户恢复密钥和一次性备用码。", currentPassword: "当前账户密码", enroll: "绑定验证器", confirmTotp: "验证并启用", disable: "关闭 2FA", rotateRecovery: "生成新的恢复密钥", rotateBackup: "重新生成备用码", acknowledge: "已保存，关闭", configured: "已配置", notConfigured: "尚未配置", optionalSecurity: "建议补全账户安全信息；这不会改变现有账户和数据库。", login: "登录", loginTitle: "登录控制台", recoveryLink: "忘记密码或验证器？", returnLogin: "返回登录", recoverTitle: "恢复账户", newPassword: "新密码", reset: "验证恢复密钥", resetConfirm: "已保存新密钥，重置账户", recovered: "账户已恢复，请使用新密码登录。", resetWarning: "恢复会重置密码、关闭原 2FA 并撤销全部登录会话和 API Token。"
};
const en = {
  title: "Get started with NetSentinel", subtitle: "Choose storage, create an administrator, secure your account.", steps: ["Database", "Administrator", "Security", "Get started"],
  token: "One-time installation token", tokenHint: "Find it in container logs or /app/data/setup.token.", unlock: "Verify installation token", next: "Continue", back: "Back",
  database: "Database type", sqlite: "Built-in SQLite", postgresql: "External PostgreSQL", redis: "External Redis", sqliteHint: "No external database required. Data lives at /app/data/database/netsentinel.sqlite; persist the entire /app/data directory.",
  host: "Server address", port: "Port", username: "Database username", dbPassword: "Database password", dbName: "Database name", dbNumber: "Redis database number", namespace: "Redis namespace", tls: "Enable TLS", redisHint: "Redis must enable AOF and noeviction. It holds all business data, not just cache.",
  loginPassword: "Password", signingIn: "Signing in…",
  accountName: "Account name", identifier: "Account name or email", accountNameHint: "Use letters, numbers, dots, underscores or hyphens. You can add an email after signing in.",
  email: "Email", displayName: "Display name", password: "Administrator password", confirmPassword: "Confirm password", passwordHint: "At least 12 characters. No default administrator password.",
  enableTotp: "Enable authenticator 2FA (optional)", code: "Authenticator or backup code", secret: "Manual authenticator secret", recovery: "Account recovery key", recoveryHint: "Shown once. Use it to recover a forgotten password; it is not the deployment encryption key.",
  saved: "I saved the recovery key and backup codes securely", backupCodes: "Single-use backup codes", download: "Download security information", finish: "Finish setup", ready: "Setup complete", readyHint: "Your database and integrated task runner are ready.", start: "Open console", https: "Use HTTPS or a secure localhost connection for setup and account recovery.",
  existing: "An existing site was found. Sign in as its administrator to adopt it without replacing data.", adopt: "Adopt existing site", pending: "Working…", retry: "Retry", required: "Complete this step first.", accountSecurity: "Account security", securityHint: "Manage your authenticator, recovery key and backup codes.", currentPassword: "Current password", enroll: "Set up authenticator", confirmTotp: "Verify and enable", disable: "Disable 2FA", rotateRecovery: "Generate recovery key", rotateBackup: "Regenerate backup codes", acknowledge: "Saved, close", configured: "Configured", notConfigured: "Not configured", optionalSecurity: "Consider completing account security. Existing accounts and storage remain unchanged.", login: "Sign in", loginTitle: "Sign in", recoveryLink: "Lost your password or authenticator?", returnLogin: "Back to sign in", recoverTitle: "Recover account", newPassword: "New password", reset: "Verify recovery key", resetConfirm: "Saved new key, reset account", recovered: "Account recovered. Sign in with your new password.", resetWarning: "Recovery resets your password, disables previous 2FA and revokes all sessions and API tokens."
};
i18n.addResourceBundle("zh-CN", "translation", { onboarding: zh, nav: { security: zh.accountSecurity } }, true, true);
i18n.addResourceBundle("en-US", "translation", { onboarding: en, nav: { security: en.accountSecurity } }, true, true);
i18n.addResourceBundle("zh-CN", "translation", { onboarding: { savedRecovery: "我已安全保存账户恢复密钥" } }, true, true);
i18n.addResourceBundle("en-US", "translation", { onboarding: { savedRecovery: "I saved my account recovery key securely" } }, true, true);
